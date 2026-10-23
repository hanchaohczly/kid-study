import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { compareKnowledgePointsByPage } from './content-repository.js'
import type {
  ContentRepository,
  ContentStatus,
  CreateKnowledgePointInput,
  CreateQuestionInput,
  DiagnosisProbes,
  KnowledgePoint,
  OptionHints,
  QuestionForParent,
  QuestionPrivate,
  QuestionPublic,
  QuestionType,
} from './content-repository.js'

interface KnowledgePointRow {
  id: string
  family_id: string
  code: string
  name: string
  chapter: string
  summary: string
  source_page_start: number | null
  source_page_end: number | null
  prerequisite_codes: string[]
  status: ContentStatus
  created_at: Date
  updated_at: Date
}

interface QuestionRow {
  id: string
  family_id: string
  kp_id: string
  knowledge_point_name: string
  stem: string
  options: Array<{ key: string; text: string }>
  question_type: QuestionType
  difficulty: 1 | 2 | 3 | 4 | 5
  status: ContentStatus
  answer_key: string
  reference_steps: string[]
  scoring_points: string[]
  hints: [string, string, string]
  option_hints: OptionHints
  diagnosis_probes: DiagnosisProbes
  created_at: Date
  updated_at: Date
}

const questionSelect = `
  select q.id, q.family_id, q.kp_id, kp.name as knowledge_point_name,
         q.stem, q.options, q.question_type, q.difficulty, q.status,
         qp.answer_key, qp.reference_steps, qp.scoring_points, qp.hints,
         qp.option_hints, qp.diagnosis_probes,
         q.created_at, q.updated_at
    from question q
    join knowledge_point kp
      on kp.id = q.kp_id and kp.family_id = q.family_id
    join question_private qp
      on qp.question_id = q.id and qp.family_id = q.family_id
`

export class PostgresContentRepository implements ContentRepository {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 })
  }

  async listKnowledgePoints(familyId: string): Promise<KnowledgePoint[]> {
    const result = await this.pool.query<KnowledgePointRow>(
      `select id, family_id, code, name, chapter, summary, source_page_start,
              source_page_end, prerequisite_codes, status, created_at, updated_at
         from knowledge_point
        where family_id = $1
        order by source_page_start asc nulls last,
                 source_page_end asc nulls last,
                 code,
                 name`,
      [familyId],
    )
    return result.rows.map(toKnowledgePoint).sort(compareKnowledgePointsByPage)
  }

  async createKnowledgePoint(
    familyId: string,
    input: CreateKnowledgePointInput,
  ): Promise<KnowledgePoint> {
    const result = await this.pool.query<KnowledgePointRow>(
      `insert into knowledge_point (
         id, family_id, code, name, chapter, summary, source_page_start,
         source_page_end, prerequisite_codes, status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, family_id, code, name, chapter, summary, source_page_start,
                 source_page_end, prerequisite_codes, status, created_at, updated_at`,
      [
        randomUUID(),
        familyId,
        input.code,
        input.name,
        input.chapter,
        input.summary ?? '',
        input.sourcePageStart ?? null,
        input.sourcePageEnd ?? null,
        input.prerequisiteCodes ?? [],
        input.status,
      ],
    )
    return toKnowledgePoint(result.rows[0]!)
  }

  async setKnowledgePointStatus(
    familyId: string,
    id: string,
    status: ContentStatus,
  ): Promise<KnowledgePoint | undefined> {
    const result = await this.pool.query<KnowledgePointRow>(
      `update knowledge_point
          set status = $3, updated_at = now()
        where family_id = $1 and id = $2
        returning id, family_id, code, name, chapter, summary, source_page_start,
                  source_page_end, prerequisite_codes, status, created_at, updated_at`,
      [familyId, id, status],
    )
    return result.rows[0] ? toKnowledgePoint(result.rows[0]) : undefined
  }

  async listQuestionsForParent(familyId: string): Promise<QuestionForParent[]> {
    const result = await this.pool.query<QuestionRow>(
      `${questionSelect}
       where q.family_id = $1
       order by q.created_at, q.id`,
      [familyId],
    )
    return result.rows.map(toQuestionForParent)
  }

  async createQuestion(
    familyId: string,
    input: CreateQuestionInput,
  ): Promise<QuestionForParent> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const knowledgePoint = await client.query<{
        name: string
        status: ContentStatus
      }>(
        `select name, status
           from knowledge_point
          where family_id = $1 and id = $2
          for update`,
        [familyId, input.kpId],
      )
      const kp = knowledgePoint.rows[0]
      if (!kp) throw new Error('KNOWLEDGE_POINT_NOT_FOUND')
      if (input.status === 'published' && kp.status !== 'published') {
        throw new Error('KNOWLEDGE_POINT_NOT_PUBLISHED')
      }

      const id = randomUUID()
      await client.query(
        `insert into question (
           id, family_id, kp_id, stem, options, question_type, difficulty, status
         ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [
          id,
          familyId,
          input.kpId,
          input.stem,
          JSON.stringify(input.options),
          input.questionType,
          input.difficulty,
          input.status,
        ],
      )
      await client.query(
        `insert into question_private (
           question_id, family_id, answer_key, reference_steps,
           scoring_points, hints, option_hints, diagnosis_probes
         ) values (
           $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
           $8::jsonb
         )`,
        [
          id,
          familyId,
          input.answerKey,
          JSON.stringify(input.referenceSteps),
          JSON.stringify(input.scoringPoints),
          JSON.stringify(input.hints),
          JSON.stringify(input.optionHints),
          JSON.stringify(input.diagnosisProbes),
        ],
      )
      const result = await this.selectQuestion(client, familyId, id)
      await client.query('commit')
      return toQuestionForParent(result)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async setQuestionStatus(
    familyId: string,
    id: string,
    status: ContentStatus,
  ): Promise<QuestionForParent | undefined> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      if (status === 'published') {
        const kp = await client.query<{ status: ContentStatus }>(
          `select kp.status
             from question q
             join knowledge_point kp
               on kp.id = q.kp_id and kp.family_id = q.family_id
            where q.family_id = $1 and q.id = $2`,
          [familyId, id],
        )
        if (!kp.rows[0]) {
          await client.query('rollback')
          return undefined
        }
        if (kp.rows[0].status !== 'published') {
          throw new Error('KNOWLEDGE_POINT_NOT_PUBLISHED')
        }
      }
      const updated = await client.query(
        `update question
            set status = $3, updated_at = now()
          where family_id = $1 and id = $2
          returning id`,
        [familyId, id, status],
      )
      if (!updated.rowCount) {
        await client.query('rollback')
        return undefined
      }
      const result = await this.selectQuestion(client, familyId, id)
      await client.query('commit')
      return toQuestionForParent(result)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async listPublishedQuestionsByIds(
    familyId: string,
    questionIds: string[],
  ): Promise<QuestionPublic[]> {
    if (!questionIds.length) return []
    const result = await this.pool.query<QuestionRow>(
      `${questionSelect}
       where q.family_id = $1 and q.status = 'published'
         and q.id = any($2::uuid[])`,
      [familyId, questionIds],
    )
    const byId = new Map(
      result.rows.map((row) => [row.id, toQuestionPublic(row)]),
    )
    return questionIds.flatMap((id) => {
      const question = byId.get(id)
      return question ? [question] : []
    })
  }

  async findPublishedQuestion(
    familyId: string,
    questionId: string,
  ): Promise<QuestionPublic | undefined> {
    const result = await this.pool.query<QuestionRow>(
      `${questionSelect}
       where q.family_id = $1 and q.id = $2 and q.status = 'published'`,
      [familyId, questionId],
    )
    return result.rows[0] ? toQuestionPublic(result.rows[0]) : undefined
  }

  async findQuestionPrivate(
    familyId: string,
    questionId: string,
  ): Promise<QuestionPrivate | undefined> {
    const result = await this.pool.query<{
      question_id: string
      family_id: string
      answer_key: string
      reference_steps: string[]
      scoring_points: string[]
      hints: [string, string, string]
      option_hints: OptionHints
      diagnosis_probes: DiagnosisProbes
    }>(
      `select qp.question_id, qp.family_id, qp.answer_key,
              qp.reference_steps, qp.scoring_points, qp.hints,
              qp.option_hints, qp.diagnosis_probes
         from question_private qp
         join question q
           on q.id = qp.question_id and q.family_id = qp.family_id
        where qp.family_id = $1 and qp.question_id = $2
          and q.status = 'published'`,
      [familyId, questionId],
    )
    const row = result.rows[0]
    return row
      ? {
          questionId: row.question_id,
          familyId: row.family_id,
          answerKey: row.answer_key,
          referenceSteps: row.reference_steps,
          scoringPoints: row.scoring_points,
          hints: row.hints,
          optionHints: row.option_hints,
          diagnosisProbes: row.diagnosis_probes,
        }
      : undefined
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private async selectQuestion(
    client: PoolClient,
    familyId: string,
    id: string,
  ): Promise<QuestionRow> {
    const result = await client.query<QuestionRow>(
      `${questionSelect} where q.family_id = $1 and q.id = $2`,
      [familyId, id],
    )
    return result.rows[0]!
  }
}

function toKnowledgePoint(row: KnowledgePointRow): KnowledgePoint {
  return {
    id: row.id,
    familyId: row.family_id,
    code: row.code,
    name: row.name,
    chapter: row.chapter,
    summary: row.summary,
    ...(row.source_page_start
      ? { sourcePageStart: row.source_page_start }
      : {}),
    ...(row.source_page_end ? { sourcePageEnd: row.source_page_end } : {}),
    prerequisiteCodes: row.prerequisite_codes,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toQuestionPublic(row: QuestionRow): QuestionPublic {
  return {
    id: row.id,
    familyId: row.family_id,
    kpId: row.kp_id,
    knowledgePointName: row.knowledge_point_name,
    stem: row.stem,
    options: row.options,
    questionType: row.question_type,
    difficulty: row.difficulty,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toQuestionForParent(row: QuestionRow): QuestionForParent {
  return {
    ...toQuestionPublic(row),
    knowledgePointName: row.knowledge_point_name,
    answerKey: row.answer_key,
    referenceSteps: row.reference_steps,
    scoringPoints: row.scoring_points,
    hints: row.hints,
    optionHints: row.option_hints,
    diagnosisProbes: row.diagnosis_probes,
  }
}
