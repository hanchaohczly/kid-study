import { createHash } from 'node:crypto'
import type {
  EventBatchResult,
  EventResult,
  LearningEventInput,
  RequestContext,
} from '@kid-study/contracts'
import type { EventRepository } from './event-repository.js'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

export function fingerprintEvent(event: LearningEventInput): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(event)))
    .digest('hex')
}

export class EventService {
  constructor(private readonly repository: EventRepository) {}

  async ingest(
    context: RequestContext,
    events: LearningEventInput[],
  ): Promise<EventBatchResult> {
    const results: EventResult[] = []

    for (const event of events) {
      const result = await this.repository.insert(
        context,
        event,
        fingerprintEvent(event),
      )

      switch (result.status) {
        case 'accepted':
        case 'duplicated':
          results.push({ eventId: event.eventId, status: result.status })
          break
        case 'event_conflict':
          results.push({
            eventId: event.eventId,
            status: 'rejected',
            code: 'EVENT_ID_CONFLICT',
            retryable: false,
          })
          break
        case 'sequence_conflict':
          results.push({
            eventId: event.eventId,
            status: 'rejected',
            code: 'LOCAL_SEQUENCE_CONFLICT',
            retryable: false,
          })
          break
      }
    }

    return {
      results,
      serverTime: new Date().toISOString(),
    }
  }
}
