import { Pool, type PoolClient } from 'pg'
import type { LearningEventInput, RequestContext } from '@kid-study/contracts'
import type {
  EventRepository,
  InsertEventResult,
  StoredLearningEvent,
} from './event-repository.js'

interface ExistingRow {
  event_id: string
  fingerprint: string
  family_id: string
  actor_id: string
  device_id: string
}

export class PostgresEventRepository implements EventRepository {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 })
  }

  async insert(
    context: RequestContext,
    event: LearningEventInput,
    fingerprint: string,
  ): Promise<InsertEventResult> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const existing = await this.findByEventId(client, event.eventId)
      if (existing) {
        await client.query('rollback')
        return existing.family_id === context.familyId &&
          existing.actor_id === context.userId &&
          existing.device_id === context.deviceId &&
          existing.fingerprint === fingerprint
          ? { status: 'duplicated' }
          : { status: 'event_conflict' }
      }

      if (
        event.businessKey &&
        (event.type === 'training_started' || event.type === 'training_completed')
      ) {
        const businessDuplicate = await client.query(
          `select 1
             from learning_event
            where family_id = $1
              and actor_id = $2
              and event_type = $3
              and business_key = $4`,
          [
            context.familyId,
            context.userId,
            event.type,
            event.businessKey,
          ],
        )
        if (businessDuplicate.rowCount) {
          await client.query('rollback')
          return { status: 'duplicated' }
        }
      }

      const sequence = await client.query<ExistingRow>(
        `select event_id, fingerprint, family_id, actor_id, device_id
           from learning_event
          where device_id = $1 and local_seq = $2`,
        [context.deviceId, event.localSeq],
      )
      if (sequence.rowCount) {
        await client.query('rollback')
        return { status: 'sequence_conflict' }
      }

      await client.query(
        `insert into learning_event (
          event_id, family_id, actor_id, device_id, schema_version,
          event_type, created_at_local, local_seq, received_at,
          causation_id, business_key, kp_ids, payload, fingerprint
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, now(),
          $9, $10, $11, $12::jsonb, $13
        )`,
        [
          event.eventId,
          context.familyId,
          context.userId,
          context.deviceId,
          event.schemaVersion,
          event.type,
          event.createdAtLocal,
          event.localSeq,
          event.causationId ?? null,
          event.businessKey ?? null,
          event.kpIds,
          JSON.stringify(event.payload),
          fingerprint,
        ],
      )

      await client.query(
        `insert into projection_job (family_id, job_type, dedup_key, payload)
         values ($1, 'mastery_rebuild', $2, $3::jsonb)
         on conflict (dedup_key) where status in ('pending', 'running')
         do nothing`,
        [
          context.familyId,
          `mastery:${context.familyId}:${event.eventId}`,
          JSON.stringify({ eventId: event.eventId, kpIds: event.kpIds }),
        ],
      )
      await client.query('commit')
      return { status: 'accepted' }
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async listForFamily(familyId: string): Promise<StoredLearningEvent[]> {
    const result = await this.pool.query<{
      event_id: string
      family_id: string
      actor_id: string
      device_id: string
      schema_version: 1
      event_type: StoredLearningEvent['type']
      created_at_local: Date
      local_seq: string
      received_at: Date
      causation_id: string | null
      business_key: string | null
      kp_ids: string[]
      payload: Record<string, unknown>
      fingerprint: string
    }>(
      `select event_id, family_id, actor_id, device_id, schema_version,
              event_type, created_at_local, local_seq, received_at,
              causation_id, business_key, kp_ids, payload, fingerprint
         from learning_event
        where family_id = $1
        order by received_at, event_id`,
      [familyId],
    )

    return result.rows.map((row) => ({
      eventId: row.event_id,
      familyId: row.family_id,
      actorId: row.actor_id,
      deviceId: row.device_id,
      schemaVersion: row.schema_version,
      type: row.event_type,
      createdAtLocal: row.created_at_local.toISOString(),
      localSeq: Number(row.local_seq),
      ...(row.causation_id ? { causationId: row.causation_id } : {}),
      ...(row.business_key ? { businessKey: row.business_key } : {}),
      kpIds: row.kp_ids,
      payload: row.payload,
      receivedAt: row.received_at.toISOString(),
      fingerprint: row.fingerprint,
    }))
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private async findByEventId(
    client: PoolClient,
    eventId: string,
  ): Promise<ExistingRow | undefined> {
    const result = await client.query<ExistingRow>(
      `select event_id, fingerprint, family_id, actor_id, device_id
         from learning_event
        where event_id = $1`,
      [eventId],
    )
    return result.rows[0]
  }
}
