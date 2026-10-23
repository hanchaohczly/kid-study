import { describe, expect, it } from 'vitest'
import type { LearningEventInput } from '@kid-study/contracts'
import { contextForTest } from '../../app.js'
import { EventService } from './event-service.js'
import { InMemoryEventRepository } from './in-memory-event-repository.js'

function event(overrides: Partial<LearningEventInput> = {}): LearningEventInput {
  return {
    eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    schemaVersion: 1,
    type: 'answer_submitted',
    createdAtLocal: '2026-10-10T08:00:00+08:00',
    localSeq: 1,
    kpIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
    payload: {
      questionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      answer: 'B',
      elapsedMs: 12_000,
    },
    ...overrides,
  }
}

describe('EventService', () => {
  it('accepts an event once and treats an identical retry as duplicated', async () => {
    const service = new EventService(new InMemoryEventRepository())
    const context = contextForTest()

    const first = await service.ingest(context, [event()])
    const retry = await service.ingest(context, [event()])

    expect(first.results).toEqual([
      {
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'accepted',
      },
    ])
    expect(retry.results[0]?.status).toBe('duplicated')
  })

  it('rejects reuse of an event id with different content', async () => {
    const service = new EventService(new InMemoryEventRepository())
    const context = contextForTest()

    await service.ingest(context, [event()])
    const conflict = await service.ingest(context, [
      event({ payload: { answer: 'A' } }),
    ])

    expect(conflict.results[0]).toMatchObject({
      status: 'rejected',
      code: 'EVENT_ID_CONFLICT',
      retryable: false,
    })
  })

  it('rejects a reused device sequence with another event id', async () => {
    const service = new EventService(new InMemoryEventRepository())
    const context = contextForTest()

    await service.ingest(context, [event()])
    const conflict = await service.ingest(context, [
      event({
        eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    ])

    expect(conflict.results[0]).toMatchObject({
      status: 'rejected',
      code: 'LOCAL_SEQUENCE_CONFLICT',
      retryable: false,
    })
  })

  it('deduplicates a training lifecycle event by its business key', async () => {
    const service = new EventService(new InMemoryEventRepository())
    const context = contextForTest()
    const started = event({
      type: 'training_started',
      businessKey: 'plan-2026-10-10',
    })

    await service.ingest(context, [started])
    const retry = await service.ingest(context, [
      {
        ...started,
        eventId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        localSeq: 2,
      },
    ])

    expect(retry.results[0]?.status).toBe('duplicated')
  })

  it('does not acknowledge an event id uploaded from another family', async () => {
    const service = new EventService(new InMemoryEventRepository())
    await service.ingest(contextForTest(), [event()])

    const conflict = await service.ingest(
      contextForTest({
        familyId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      }),
      [event()],
    )

    expect(conflict.results[0]).toMatchObject({
      status: 'rejected',
      code: 'EVENT_ID_CONFLICT',
    })
  })
})
