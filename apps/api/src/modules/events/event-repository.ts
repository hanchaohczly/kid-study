import type { LearningEventInput, RequestContext } from '@kid-study/contracts'

export interface StoredLearningEvent extends LearningEventInput {
  familyId: string
  actorId: string
  deviceId: string
  receivedAt: string
  fingerprint: string
}

export type InsertEventResult =
  | { status: 'accepted' }
  | { status: 'duplicated' }
  | { status: 'event_conflict' }
  | { status: 'sequence_conflict' }

export interface EventRepository {
  insert(
    context: RequestContext,
    event: LearningEventInput,
    fingerprint: string,
  ): Promise<InsertEventResult>
  listForFamily(familyId: string): Promise<StoredLearningEvent[]>
  close(): Promise<void>
}
