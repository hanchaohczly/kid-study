import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'

export type MasteryStatus = 'insufficient' | 'weak' | 'basic' | 'mastered'
export type ReviewDecision = 'agree' | 'disagree' | 'unsure'

export interface MasteryCalculationDetails {
  accuracy: number
  hintDependence: number
  averageHintLevel: number
  stability: number
  speed: number
  averageDurationMs: number | null
  latestIndependentCorrect: boolean
  insufficiencyReasons: string[]
}

export interface MasteryProjection {
  id: string
  familyId: string
  kidId: string
  kpId: string
  modelVersion: string
  status: MasteryStatus
  score: number | null
  sampleCount: number
  independentCount: number
  independentCorrectCount: number
  spacedDayCount: number
  evidenceFrom: string
  evidenceTo: string
  evidenceFingerprint: string
  calculationDetails: MasteryCalculationDetails
  projectionVersion: number
  createdAt: string
  updatedAt: string
}

export type SaveProjectionInput = Omit<
  MasteryProjection,
  'id' | 'projectionVersion' | 'createdAt' | 'updatedAt'
>

export interface MasteryReview {
  id: string
  familyId: string
  projectionId: string
  projectionVersion: number
  reviewerId: string
  decision: ReviewDecision
  note?: string
  createdAt: string
}

export interface MasteryRepository {
  saveProjection(input: SaveProjectionInput): Promise<MasteryProjection>
  listLatestReviews(
    familyId: string,
    kidId: string,
  ): Promise<Map<string, MasteryReview>>
  saveReview(input: {
    familyId: string
    projectionId: string
    projectionVersion: number
    reviewerId: string
    decision: ReviewDecision
    note?: string
  }): Promise<MasteryReview>
  close(): Promise<void>
}

export class InMemoryMasteryRepository implements MasteryRepository {
  private readonly projections = new Map<string, MasteryProjection>()
  private readonly reviews: MasteryReview[] = []

  async saveProjection(input: SaveProjectionInput): Promise<MasteryProjection> {
    const key = projectionKey(input)
    const existing = this.projections.get(key)
    if (existing?.evidenceFingerprint === input.evidenceFingerprint) {
      return structuredClone(existing)
    }
    const now = new Date().toISOString()
    const projection: MasteryProjection = {
      ...structuredClone(input),
      id: existing?.id ?? randomUUID(),
      projectionVersion: (existing?.projectionVersion ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.projections.set(key, projection)
    return structuredClone(projection)
  }

  async listLatestReviews(
    familyId: string,
    kidId: string,
  ): Promise<Map<string, MasteryReview>> {
    const projectionIds = new Set(
      [...this.projections.values()]
        .filter(
          (projection) =>
            projection.familyId === familyId && projection.kidId === kidId,
        )
        .map((projection) => projection.id),
    )
    const latest = new Map<string, MasteryReview>()
    for (const review of this.reviews) {
      if (!projectionIds.has(review.projectionId)) continue
      const current = latest.get(review.projectionId)
      if (!current || current.createdAt < review.createdAt) {
        latest.set(review.projectionId, structuredClone(review))
      }
    }
    return latest
  }

  async saveReview(input: {
    familyId: string
    projectionId: string
    projectionVersion: number
    reviewerId: string
    decision: ReviewDecision
    note?: string
  }): Promise<MasteryReview> {
    const projection = [...this.projections.values()].find(
      (item) =>
        item.id === input.projectionId && item.familyId === input.familyId,
    )
    if (!projection) throw new Error('MASTERY_PROJECTION_NOT_FOUND')
    if (projection.projectionVersion !== input.projectionVersion) {
      throw new Error('PROJECTION_CHANGED')
    }
    const review: MasteryReview = {
      id: randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
    }
    this.reviews.push(review)
    return structuredClone(review)
  }

  async close(): Promise<void> {}
}

interface ProjectionRow {
  id: string
  family_id: string
  kid_id: string
  kp_id: string
  model_version: string
  status: MasteryStatus
  score: string | null
  sample_count: number
  independent_count: number
  independent_correct_count: number
  spaced_day_count: number
  evidence_from: Date
  evidence_to: Date
  evidence_fingerprint: string
  calculation_details: MasteryCalculationDetails
  projection_version: number
  created_at: Date
  updated_at: Date
}

interface ReviewRow {
  id: string
  family_id: string
  projection_id: string
  projection_version: number
  reviewer_id: string
  decision: ReviewDecision
  note: string | null
  created_at: Date
}

export class PostgresMasteryRepository implements MasteryRepository {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 })
  }

  async saveProjection(input: SaveProjectionInput): Promise<MasteryProjection> {
    const result = await this.pool.query<ProjectionRow>(
      `insert into mastery_projection (
         id, family_id, kid_id, kp_id, model_version, status, score,
         sample_count, independent_count, independent_correct_count,
         spaced_day_count, evidence_from, evidence_to, evidence_fingerprint,
         calculation_details
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15::jsonb
       )
       on conflict (family_id, kid_id, kp_id, model_version) do update
         set status = excluded.status,
             score = excluded.score,
             sample_count = excluded.sample_count,
             independent_count = excluded.independent_count,
             independent_correct_count = excluded.independent_correct_count,
             spaced_day_count = excluded.spaced_day_count,
             evidence_from = excluded.evidence_from,
             evidence_to = excluded.evidence_to,
             evidence_fingerprint = excluded.evidence_fingerprint,
             calculation_details = excluded.calculation_details,
             projection_version =
               case
                 when mastery_projection.evidence_fingerprint
                      <> excluded.evidence_fingerprint
                 then mastery_projection.projection_version + 1
                 else mastery_projection.projection_version
               end,
             updated_at =
               case
                 when mastery_projection.evidence_fingerprint
                      <> excluded.evidence_fingerprint
                 then now()
                 else mastery_projection.updated_at
               end
       returning id, family_id, kid_id, kp_id, model_version, status, score,
                 sample_count, independent_count, independent_correct_count,
                 spaced_day_count, evidence_from, evidence_to,
                 evidence_fingerprint, calculation_details,
                 projection_version, created_at, updated_at`,
      [
        randomUUID(),
        input.familyId,
        input.kidId,
        input.kpId,
        input.modelVersion,
        input.status,
        input.score,
        input.sampleCount,
        input.independentCount,
        input.independentCorrectCount,
        input.spacedDayCount,
        input.evidenceFrom,
        input.evidenceTo,
        input.evidenceFingerprint,
        JSON.stringify(input.calculationDetails),
      ],
    )
    return toProjection(result.rows[0]!)
  }

  async listLatestReviews(
    familyId: string,
    kidId: string,
  ): Promise<Map<string, MasteryReview>> {
    const result = await this.pool.query<ReviewRow>(
      `select distinct on (review.projection_id)
              review.id, review.family_id, review.projection_id,
              review.projection_version, review.reviewer_id,
              review.decision, review.note, review.created_at
         from mastery_review review
         join mastery_projection projection
           on projection.family_id = review.family_id
          and projection.id = review.projection_id
        where review.family_id = $1 and projection.kid_id = $2
        order by review.projection_id, review.created_at desc, review.id desc`,
      [familyId, kidId],
    )
    return new Map(
      result.rows.map((row) => [
        row.projection_id,
        toReview(row),
      ]),
    )
  }

  async saveReview(input: {
    familyId: string
    projectionId: string
    projectionVersion: number
    reviewerId: string
    decision: ReviewDecision
    note?: string
  }): Promise<MasteryReview> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await this.requireCurrentProjection(client, input)
      const result = await client.query<ReviewRow>(
        `insert into mastery_review (
           id, family_id, projection_id, projection_version,
           reviewer_id, decision, note
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id, family_id, projection_id, projection_version,
                   reviewer_id, decision, note, created_at`,
        [
          randomUUID(),
          input.familyId,
          input.projectionId,
          input.projectionVersion,
          input.reviewerId,
          input.decision,
          input.note ?? null,
        ],
      )
      await client.query('commit')
      return toReview(result.rows[0]!)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private async requireCurrentProjection(
    client: PoolClient,
    input: {
      familyId: string
      projectionId: string
      projectionVersion: number
    },
  ): Promise<void> {
    const result = await client.query<{ projection_version: number }>(
      `select projection_version
         from mastery_projection
        where family_id = $1 and id = $2
        for update`,
      [input.familyId, input.projectionId],
    )
    const projection = result.rows[0]
    if (!projection) throw new Error('MASTERY_PROJECTION_NOT_FOUND')
    if (projection.projection_version !== input.projectionVersion) {
      throw new Error('PROJECTION_CHANGED')
    }
  }
}

function projectionKey(input: SaveProjectionInput): string {
  return [
    input.familyId,
    input.kidId,
    input.kpId,
    input.modelVersion,
  ].join(':')
}

function toProjection(row: ProjectionRow): MasteryProjection {
  return {
    id: row.id,
    familyId: row.family_id,
    kidId: row.kid_id,
    kpId: row.kp_id,
    modelVersion: row.model_version,
    status: row.status,
    score: row.score === null ? null : Number(row.score),
    sampleCount: row.sample_count,
    independentCount: row.independent_count,
    independentCorrectCount: row.independent_correct_count,
    spacedDayCount: row.spaced_day_count,
    evidenceFrom: row.evidence_from.toISOString(),
    evidenceTo: row.evidence_to.toISOString(),
    evidenceFingerprint: row.evidence_fingerprint,
    calculationDetails: row.calculation_details,
    projectionVersion: row.projection_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toReview(row: ReviewRow): MasteryReview {
  return {
    id: row.id,
    familyId: row.family_id,
    projectionId: row.projection_id,
    projectionVersion: row.projection_version,
    reviewerId: row.reviewer_id,
    decision: row.decision,
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at.toISOString(),
  }
}
