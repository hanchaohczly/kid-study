import Dexie, { type EntityTable } from 'dexie'
import type { EventType, LearningEventInput } from '@kid-study/contracts'
import type { SessionUser, TodayTraining } from '../api'

export interface OutboxRecord {
  eventId: string
  localSeq: number
  event: LearningEventInput
  status: 'pending' | 'syncing' | 'failed'
  attemptCount: number
  nextAttemptAt: number
  errorCode?: string
  syncingAt?: number
  createdAt: number
}

interface SyncMeta {
  key: 'localSeq'
  value: number
}

export interface PendingAnswerRecord {
  submissionId: string
  attemptId: string
  questionId: string
  answer: string
  kpId: string
  elapsedMs: number
  status: 'pending' | 'syncing' | 'failed'
  attemptCount: number
  nextAttemptAt: number
  errorCode?: string
  syncingAt?: number
  createdAt: number
}

export interface ChildWorkspaceCache {
  key: 'current-child'
  userId: string
  session: SessionUser
  training: TodayTraining
  questionIndex: number
  attemptIds: Record<string, string>
  elapsedSeconds: number
  cachedAt: number
}

class LearningDatabase extends Dexie {
  outbox!: EntityTable<OutboxRecord, 'eventId'>
  syncMeta!: EntityTable<SyncMeta, 'key'>
  pendingAnswers!: EntityTable<PendingAnswerRecord, 'submissionId'>
  workspaceCache!: EntityTable<ChildWorkspaceCache, 'key'>

  constructor() {
    super('kid-study')
    this.version(1).stores({
      outbox: 'eventId, localSeq, status, nextAttemptAt, createdAt',
      syncMeta: 'key',
    })
    this.version(2).stores({
      outbox: 'eventId, localSeq, status, nextAttemptAt, createdAt',
      syncMeta: 'key',
      pendingAnswers:
        'submissionId, attemptId, questionId, status, nextAttemptAt, createdAt',
      workspaceCache: 'key, userId, cachedAt',
    })
  }
}

export const db = new LearningDatabase()

interface NewEvent {
  type: EventType
  payload: Record<string, unknown>
  kpIds?: string[]
  businessKey?: string
  causationId?: string
}

export async function enqueueEvent(input: NewEvent): Promise<LearningEventInput> {
  return db.transaction('rw', db.outbox, db.syncMeta, async () => {
    const meta = await db.syncMeta.get('localSeq')
    const localSeq = (meta?.value ?? 0) + 1
    await db.syncMeta.put({ key: 'localSeq', value: localSeq })

    const event: LearningEventInput = {
      eventId: crypto.randomUUID(),
      schemaVersion: 1,
      type: input.type,
      createdAtLocal: new Date().toISOString(),
      localSeq,
      kpIds: input.kpIds ?? [],
      payload: input.payload,
      ...(input.businessKey ? { businessKey: input.businessKey } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
    }

    await db.outbox.add({
      eventId: event.eventId,
      localSeq,
      event,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
    })
    return event
  })
}

export async function enqueuePendingAnswer(
  input: Omit<
    PendingAnswerRecord,
    'status' | 'attemptCount' | 'nextAttemptAt' | 'createdAt'
  >,
): Promise<void> {
  await db.transaction('rw', db.pendingAnswers, async () => {
    const queuedCount = await db.pendingAnswers.count()
    if (queuedCount >= 100) {
      throw new Error('离线作答队列已满，请联网同步后继续')
    }
    await db.pendingAnswers.put({
      ...input,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
    })
  })
}

export async function findPendingAnswer(
  questionId: string,
): Promise<PendingAnswerRecord | undefined> {
  return db.pendingAnswers
    .where('questionId')
    .equals(questionId)
    .filter((record) => record.status !== 'failed')
    .first()
}

export async function cacheChildWorkspace(
  input: Omit<ChildWorkspaceCache, 'key' | 'userId' | 'cachedAt'>,
): Promise<void> {
  if (input.session.role !== 'child') return
  await db.workspaceCache.put({
    key: 'current-child',
    userId: input.session.id,
    ...input,
    cachedAt: Date.now(),
  })
}

export async function getCachedChildWorkspace(): Promise<
  ChildWorkspaceCache | undefined
> {
  const cached = await db.workspaceCache.get('current-child')
  if (!cached) return undefined
  const maxCacheAgeMs = 36 * 60 * 60 * 1000
  if (cached.cachedAt < Date.now() - maxCacheAgeMs) {
    await db.workspaceCache.delete('current-child')
    return undefined
  }
  return cached
}

export async function clearCachedChildWorkspace(): Promise<void> {
  await db.workspaceCache.delete('current-child')
}

export async function pendingCount(): Promise<number> {
  const [events, answers] = await Promise.all([
    db.outbox.count(),
    db.pendingAnswers.count(),
  ])
  return events + answers
}
