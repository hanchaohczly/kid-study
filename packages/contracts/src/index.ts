import { z } from 'zod'

export const eventTypes = [
  'training_started',
  'answer_submitted',
  'hint_requested',
  'hint_used',
  'question_skipped',
  'training_abandoned',
  'training_completed',
  'review_completed',
] as const

export const eventTypeSchema = z.enum(eventTypes)
export type EventType = z.infer<typeof eventTypeSchema>

const eventPayloadSchema = z.record(z.string(), z.unknown())

export const learningEventInputSchema = z.object({
  eventId: z.uuid(),
  schemaVersion: z.literal(1),
  type: eventTypeSchema,
  createdAtLocal: z.iso.datetime({ offset: true }),
  localSeq: z.number().int().nonnegative(),
  causationId: z.uuid().optional(),
  businessKey: z.string().trim().min(1).max(160).optional(),
  kpIds: z.array(z.uuid()).max(20).default([]),
  payload: eventPayloadSchema,
})

export type LearningEventInput = z.infer<typeof learningEventInputSchema>

export const eventBatchInputSchema = z.object({
  events: z.array(learningEventInputSchema).min(1).max(50),
})

export type EventBatchInput = z.infer<typeof eventBatchInputSchema>

export const eventResultSchema = z.discriminatedUnion('status', [
  z.object({
    eventId: z.uuid(),
    status: z.literal('accepted'),
  }),
  z.object({
    eventId: z.uuid(),
    status: z.literal('duplicated'),
  }),
  z.object({
    eventId: z.uuid(),
    status: z.literal('rejected'),
    code: z.string(),
    retryable: z.boolean(),
  }),
])

export type EventResult = z.infer<typeof eventResultSchema>

export const eventBatchResultSchema = z.object({
  results: z.array(eventResultSchema),
  serverTime: z.iso.datetime(),
})

export type EventBatchResult = z.infer<typeof eventBatchResultSchema>

export interface RequestContext {
  requestId: string
  userId: string
  role: 'parent' | 'child'
  familyId: string
  kidId?: string
  deviceId: string
}
