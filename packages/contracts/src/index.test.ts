import { describe, expect, it } from 'vitest'
import { eventBatchInputSchema } from './index.js'

describe('eventBatchInputSchema', () => {
  it('accepts the stable v1 event envelope', () => {
    const result = eventBatchInputSchema.safeParse({
      events: [
        {
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          schemaVersion: 1,
          type: 'training_started',
          createdAtLocal: '2026-10-10T08:00:00+08:00',
          localSeq: 1,
          kpIds: [],
          payload: { planId: 'plan-1' },
        },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('rejects unsupported schema versions and unknown event types', () => {
    const result = eventBatchInputSchema.safeParse({
      events: [
        {
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          schemaVersion: 2,
          type: 'answer_rewritten',
          createdAtLocal: '2026-10-10T08:00:00+08:00',
          localSeq: 1,
          payload: {},
        },
      ],
    })

    expect(result.success).toBe(false)
  })
})
