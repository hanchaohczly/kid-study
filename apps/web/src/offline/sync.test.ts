import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheChildWorkspace,
  db,
  enqueueEvent,
  enqueuePendingAnswer,
  getCachedChildWorkspace,
  pendingCount,
} from './database'
import { syncOutbox, syncPendingAnswers } from './sync'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('outbox sync', () => {
  it('assigns monotonic local sequence numbers in one database transaction', async () => {
    const first = await enqueueEvent({
      type: 'training_started',
      payload: { planId: 'plan-1' },
    })
    const second = await enqueueEvent({
      type: 'training_completed',
      payload: { planId: 'plan-1' },
    })

    expect(first.localSeq).toBe(1)
    expect(second.localSeq).toBe(2)
    expect(await pendingCount()).toBe(2)
  })

  it('removes accepted and duplicated events from the outbox', async () => {
    const first = await enqueueEvent({
      type: 'training_started',
      payload: { planId: 'plan-1' },
    })
    const second = await enqueueEvent({
      type: 'training_completed',
      payload: { planId: 'plan-1' },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              { eventId: first.eventId, status: 'accepted' },
              { eventId: second.eventId, status: 'duplicated' },
            ],
            serverTime: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    const summary = await syncOutbox()

    expect(summary).toMatchObject({
      accepted: 1,
      duplicated: 1,
      remaining: 0,
    })
    expect(await pendingCount()).toBe(0)
  })

  it('keeps events pending after a network failure', async () => {
    await enqueueEvent({
      type: 'answer_submitted',
      payload: { questionId: 'question-1', answer: 'B' },
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const summary = await syncOutbox()
    const records = await db.outbox.toArray()

    expect(summary.remaining).toBe(1)
    expect(records[0]).toMatchObject({
      status: 'pending',
      attemptCount: 1,
      errorCode: 'offline',
    })
  })
})

describe('offline training', () => {
  it('caches the public training workspace without private answers', async () => {
    await cacheChildWorkspace({
      session: { id: 'kid-1', role: 'child', kidId: 'kid-1' },
      training: {
        planId: 'plan-1',
        localDate: '2026-10-14',
        title: '今日训练',
        estimatedMinutes: 15,
        stopAddingAtMinutes: 25,
        closeAtMinutes: 30,
        budget: {
          serverStartedAt: null,
          elapsedSeconds: 0,
          remainingSeconds: 1800,
          stopAddingQuestions: false,
          sessionClosed: false,
        },
        questions: [
          {
            id: 'question-1',
            kpId: 'kp-1',
            stem: '1 + 1 = ?',
            options: [
              { key: 'A', text: '1' },
              { key: 'B', text: '2' },
            ],
            questionType: 'single_choice',
            difficulty: 1,
          },
        ],
      },
      questionIndex: 0,
      attemptIds: {},
      elapsedSeconds: 0,
    })

    const cached = await getCachedChildWorkspace()

    expect(cached?.training.questions[0]).not.toHaveProperty('answerKey')
    expect(cached?.session.role).toBe('child')
  })

  it('starts the attempt and resolves a queued answer before removing it', async () => {
    await enqueuePendingAnswer({
      submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      questionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      answer: 'B',
      kpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      elapsedMs: 12_000,
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ attemptId: 'attempt-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              correct: true,
              budget: {
                serverStartedAt: '2026-10-14T00:00:00.000Z',
                elapsedSeconds: 12,
                remainingSeconds: 1788,
                stopAddingQuestions: false,
                sessionClosed: false,
              },
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        ),
    )

    const summary = await syncPendingAnswers()

    expect(summary.resolved).toHaveLength(1)
    expect(summary.resolved[0]).toMatchObject({
      questionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      correct: true,
    })
    expect(await db.pendingAnswers.count()).toBe(0)
  })

  it('keeps a queued answer after a network failure', async () => {
    await enqueuePendingAnswer({
      submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      questionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      answer: 'A',
      kpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      elapsedMs: 8_000,
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const summary = await syncPendingAnswers()
    const record = await db.pendingAnswers.toArray()

    expect(summary.remaining).toBe(1)
    expect(record[0]).toMatchObject({
      status: 'pending',
      attemptCount: 1,
      errorCode: 'offline',
    })
    expect(await pendingCount()).toBe(1)
  })
})
