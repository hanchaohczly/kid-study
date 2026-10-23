import { Pool } from 'pg'
import {
  type Assessment,
  type AssessmentEvidence,
  type AssessmentDeliveryMode,
  type AssessmentRepository,
  type AssessmentSelectionMode,
  type AssessmentTrigger,
} from './assessment-service.js'

interface AssessmentRow {
  id: string
  family_id: string
  kid_id: string
  trigger_type: AssessmentTrigger
  delivery_mode: AssessmentDeliveryMode
  selection_mode: AssessmentSelectionMode
  purpose: string
  knowledge_point_ids: string[]
  evidence_summary: AssessmentEvidence[]
  status: 'assigned'
  created_by: string
  created_at: Date
  assigned_at: Date
  question_ids: string[]
}

export class PostgresAssessmentRepository implements AssessmentRepository {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 })
  }

  async save(assessment: Assessment): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `insert into assessment (
           id, family_id, kid_id, trigger_type, delivery_mode, selection_mode,
           purpose, knowledge_point_ids, evidence_summary, status, created_by,
           created_at, assigned_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13
         )`,
        [
          assessment.id,
          assessment.familyId,
          assessment.kidId,
          assessment.trigger,
          assessment.deliveryMode,
          assessment.selectionMode,
          assessment.purpose,
          assessment.knowledgePointIds,
          JSON.stringify(assessment.evidenceSummary),
          assessment.status,
          assessment.createdBy,
          assessment.createdAt,
          assessment.assignedAt,
        ],
      )
      for (const [position, questionId] of assessment.questionIds.entries()) {
        await client.query(
          `insert into assessment_question (
             assessment_id, family_id, question_id, position
           ) values ($1, $2, $3, $4)`,
          [assessment.id, assessment.familyId, questionId, position],
        )
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async list(familyId: string, kidId: string): Promise<Assessment[]> {
    const result = await this.pool.query<AssessmentRow>(
      `${assessmentSelect}
       where a.family_id = $1 and a.kid_id = $2
       group by a.id
       order by a.created_at desc`,
      [familyId, kidId],
    )
    return result.rows.map(toAssessment)
  }

  async listAssignedQuestionIds(
    familyId: string,
    kidId: string,
    localDate: string,
  ): Promise<string[]> {
    const result = await this.pool.query<{ question_id: string }>(
      `select aq.question_id
         from assessment a
         join assessment_question aq
           on aq.assessment_id = a.id and aq.family_id = a.family_id
        where a.family_id = $1 and a.kid_id = $2 and a.status = 'assigned'
          and (a.assigned_at at time zone 'Asia/Shanghai')::date = $3::date
        order by a.assigned_at, aq.position`,
      [familyId, kidId, localDate],
    )
    return result.rows.map((row) => row.question_id)
  }

  async isQuestionAssigned(
    familyId: string,
    kidId: string,
    questionId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `select 1
         from assessment a
         join assessment_question aq
           on aq.assessment_id = a.id and aq.family_id = a.family_id
        where a.family_id = $1 and a.kid_id = $2 and a.status = 'assigned'
          and aq.question_id = $3
        limit 1`,
      [familyId, kidId, questionId],
    )
    return Boolean(result.rowCount)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

const assessmentSelect = `
  select a.id, a.family_id, a.kid_id, a.trigger_type, a.delivery_mode,
         a.selection_mode, a.purpose,
         a.knowledge_point_ids, a.evidence_summary, a.status, a.created_by,
         a.created_at, a.assigned_at,
         coalesce(
           array_agg(aq.question_id order by aq.position)
             filter (where aq.question_id is not null),
           '{}'
         ) as question_ids
    from assessment a
    left join assessment_question aq
      on aq.assessment_id = a.id and aq.family_id = a.family_id
`

function toAssessment(row: AssessmentRow): Assessment {
  return {
    id: row.id,
    familyId: row.family_id,
    kidId: row.kid_id,
    trigger: row.trigger_type,
    deliveryMode: row.delivery_mode,
    selectionMode: row.selection_mode,
    purpose: row.purpose,
    knowledgePointIds: row.knowledge_point_ids,
    questionIds: row.question_ids,
    evidenceSummary: row.evidence_summary,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    assignedAt: row.assigned_at.toISOString(),
  }
}
