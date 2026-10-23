import type { EventBatchResult } from '@kid-study/contracts'
import type { TrainingBudget } from '../api'
import { db } from './database'

const backoffMs = [2_000, 5_000, 15_000, 60_000, 300_000] as const

export interface SyncSummary {
  accepted: number
  duplicated: number
  failed: number
  remaining: number
}

export interface ResolvedPendingAnswer {
  submissionId: string
  questionId: string
  correct: boolean
  feedback?: string
  budget: TrainingBudget
}

export interface AnswerSyncSummary {
  resolved: ResolvedPendingAnswer[]
  failed: number
  remaining: number
}

export async function syncPendingAnswers(): Promise<AnswerSyncSummary> {
  const now = Date.now()
  const interrupted = await db.pendingAnswers
    .where('status')
    .equals('syncing')
    .filter((record) => !record.syncingAt || record.syncingAt < now - 60_000)
    .primaryKeys()
  if (interrupted.length) {
    await db.pendingAnswers.bulkUpdate(
      interrupted.map((key) => ({
        key,
        changes: {
          status: 'pending' as const,
          nextAttemptAt: now,
          errorCode: 'SYNC_INTERRUPTED',
        },
      })),
    )
  }

  const records = await db.pendingAnswers
    .where('nextAttemptAt')
    .belowOrEqual(now)
    .filter((record) => record.status === 'pending')
    .sortBy('createdAt')
  const batch = records.slice(0, 20)
  const resolved: ResolvedPendingAnswer[] = []
  let failed = 0

  for (const record of batch) {
    await db.pendingAnswers.update(record.submissionId, {
      status: 'syncing',
      syncingAt: Date.now(),
    })
    try {
      await answerRequest('/api/v1/training/attempts/start', {
        attemptId: record.attemptId,
        questionId: record.questionId,
      })
      const result = await answerRequest<{
        correct: boolean
        feedback?: string
        budget: TrainingBudget
      }>('/api/v1/answers/check', {
        submissionId: record.submissionId,
        attemptId: record.attemptId,
        questionId: record.questionId,
        answer: record.answer,
      })
      await db.pendingAnswers.delete(record.submissionId)
      resolved.push({
        submissionId: record.submissionId,
        questionId: record.questionId,
        correct: result.correct,
        ...(result.feedback ? { feedback: result.feedback } : {}),
        budget: result.budget,
      })
    } catch (error) {
      const code =
        error instanceof AnswerSyncHttpError
          ? error.code
          : error instanceof Error
            ? error.message
            : 'NETWORK_ERROR'
      if (error instanceof AnswerSyncHttpError && !error.retryable) {
        failed++
        await db.pendingAnswers.update(record.submissionId, {
          status: 'failed',
          errorCode: code,
        })
      } else {
        await scheduleAnswerRetry(
          record.submissionId,
          record.attemptCount,
          code,
        )
      }
      break
    }
  }

  return {
    resolved,
    failed,
    remaining: await db.pendingAnswers.count(),
  }
}

export async function syncOutbox(): Promise<SyncSummary> {
  const now = Date.now()
  const interrupted = await db.outbox
    .where('status')
    .equals('syncing')
    .filter((record) => !record.syncingAt || record.syncingAt < now - 60_000)
    .primaryKeys()
  if (interrupted.length) {
    await db.outbox.bulkUpdate(
      interrupted.map((key) => ({
        key,
        changes: {
          status: 'pending' as const,
          nextAttemptAt: now,
          errorCode: 'SYNC_INTERRUPTED',
        },
      })),
    )
  }

  const records = await db.outbox
    .where('nextAttemptAt')
    .belowOrEqual(now)
    .filter((record) => record.status === 'pending')
    .sortBy('localSeq')
  const batch = records.slice(0, 50)

  if (batch.length === 0) {
    return {
      accepted: 0,
      duplicated: 0,
      failed: 0,
      remaining: await db.outbox.count(),
    }
  }

  await db.outbox.bulkUpdate(
    batch.map((record) => ({
      key: record.eventId,
      changes: { status: 'syncing' as const, syncingAt: now },
    })),
  )

  try {
    const response = await fetch('/api/v1/events', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch.map((record) => record.event) }),
    })

    if (!response.ok) {
      throw new Error(`EVENT_SYNC_HTTP_${response.status}`)
    }

    const result = (await response.json()) as EventBatchResult
    let accepted = 0
    let duplicated = 0
    let failed = 0
    const returnedEventIds = new Set<string>()

    await db.transaction('rw', db.outbox, async () => {
      for (const item of result.results) {
        returnedEventIds.add(item.eventId)
        if (item.status === 'accepted' || item.status === 'duplicated') {
          await db.outbox.delete(item.eventId)
          item.status === 'accepted' ? accepted++ : duplicated++
          continue
        }

        const record = await db.outbox.get(item.eventId)
        if (!record) continue

        if (!item.retryable) {
          failed++
          await db.outbox.update(item.eventId, {
            status: 'failed',
            errorCode: item.code,
          })
        } else {
          await scheduleRetry(record.eventId, record.attemptCount, item.code)
        }
      }

      for (const record of batch) {
        if (!returnedEventIds.has(record.eventId)) {
          await scheduleRetry(
            record.eventId,
            record.attemptCount,
            'SYNC_RESULT_MISSING',
          )
        }
      }
    })

    return {
      accepted,
      duplicated,
      failed,
      remaining: await db.outbox.count(),
    }
  } catch (error) {
    await db.transaction('rw', db.outbox, async () => {
      for (const record of batch) {
        await scheduleRetry(
          record.eventId,
          record.attemptCount,
          error instanceof Error ? error.message : 'NETWORK_ERROR',
        )
      }
    })
    return {
      accepted: 0,
      duplicated: 0,
      failed: 0,
      remaining: await db.outbox.count(),
    }
  }
}

class AnswerSyncHttpError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(
    code: string,
    retryable: boolean,
  ) {
    super(code)
    this.code = code
    this.retryable = retryable
  }
}

async function answerRequest<T = unknown>(
  path: string,
  body: Record<string, string>,
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = (await response.json().catch(() => null)) as
    | ({ code?: string; retryable?: boolean } & T)
    | null
  if (!response.ok) {
    throw new AnswerSyncHttpError(
      result?.code ?? `ANSWER_SYNC_HTTP_${response.status}`,
      result?.retryable ??
        (response.status >= 500 || response.status === 429),
    )
  }
  return result as T
}

async function scheduleRetry(
  eventId: string,
  attemptCount: number,
  errorCode: string,
): Promise<void> {
  const nextAttemptCount = attemptCount + 1
  const delay = backoffMs[Math.min(attemptCount, backoffMs.length - 1)]
  const jitter = Math.floor(Math.random() * 500)

  await db.outbox.update(eventId, {
    status: 'pending',
    attemptCount: nextAttemptCount,
    nextAttemptAt: Date.now() + delay + jitter,
    errorCode,
  })
}

async function scheduleAnswerRetry(
  submissionId: string,
  attemptCount: number,
  errorCode: string,
): Promise<void> {
  const nextAttemptCount = attemptCount + 1
  const delay = backoffMs[Math.min(attemptCount, backoffMs.length - 1)]
  const jitter = Math.floor(Math.random() * 500)

  await db.pendingAnswers.update(submissionId, {
    status: 'pending',
    attemptCount: nextAttemptCount,
    nextAttemptAt: Date.now() + delay + jitter,
    errorCode,
  })
}
