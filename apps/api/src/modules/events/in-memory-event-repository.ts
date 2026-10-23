import type { LearningEventInput, RequestContext } from '@kid-study/contracts'
import type {
  EventRepository,
  InsertEventResult,
  StoredLearningEvent,
} from './event-repository.js'

export class InMemoryEventRepository implements EventRepository {
  private readonly events = new Map<string, StoredLearningEvent>()
  private readonly sequences = new Map<string, string>()
  private readonly businessKeys = new Map<string, string>()

  async insert(
    context: RequestContext,
    event: LearningEventInput,
    fingerprint: string,
  ): Promise<InsertEventResult> {
    const existing = this.events.get(event.eventId)
    if (existing) {
      return existing.familyId === context.familyId &&
        existing.actorId === context.userId &&
        existing.deviceId === context.deviceId &&
        existing.fingerprint === fingerprint
        ? { status: 'duplicated' }
        : { status: 'event_conflict' }
    }

    const businessKey = this.idempotentBusinessKey(context, event)
    if (businessKey && this.businessKeys.has(businessKey)) {
      return { status: 'duplicated' }
    }

    const sequenceKey = `${context.deviceId}:${event.localSeq}`
    const existingEventId = this.sequences.get(sequenceKey)
    if (existingEventId && existingEventId !== event.eventId) {
      return { status: 'sequence_conflict' }
    }

    this.events.set(event.eventId, {
      ...event,
      familyId: context.familyId,
      actorId: context.userId,
      deviceId: context.deviceId,
      receivedAt: new Date().toISOString(),
      fingerprint,
    })
    this.sequences.set(sequenceKey, event.eventId)
    if (businessKey) this.businessKeys.set(businessKey, event.eventId)
    return { status: 'accepted' }
  }

  async listForFamily(familyId: string): Promise<StoredLearningEvent[]> {
    return [...this.events.values()].filter((event) => event.familyId === familyId)
  }

  async close(): Promise<void> {}

  private idempotentBusinessKey(
    context: RequestContext,
    event: LearningEventInput,
  ): string | undefined {
    if (
      !event.businessKey ||
      (event.type !== 'training_started' && event.type !== 'training_completed')
    ) {
      return undefined
    }
    return `${context.familyId}:${context.userId}:${event.type}:${event.businessKey}`
  }
}
