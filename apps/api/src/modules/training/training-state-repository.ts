import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

export interface TrainingSession {
  id: string
  familyId: string
  kidId: string
  localDate: string
  startedAt: string
  closedAt?: string
}

export interface TrainingAttempt {
  id: string
  sessionId: string
  familyId: string
  kidId: string
  questionId: string
  hintLevel: 0 | 1 | 2 | 3
  startedAt: string
  completedAt?: string
}

export interface AnswerEvidence {
  id: string
  attemptId: string
  familyId: string
  kidId: string
  questionId: string
  kpId: string
  correct: boolean
  hintLevel: 0 | 1 | 2 | 3
  durationMs?: number
  submittedAt: string
}

export interface RecordAnswerInput extends AnswerEvidence {
  answer: string
}

export interface TrainingStateRepository {
  getOrCreateSession(
    familyId: string,
    kidId: string,
    localDate: string,
    startedAt: string,
  ): Promise<TrainingSession>
  findSession(
    familyId: string,
    kidId: string,
    localDate: string,
  ): Promise<TrainingSession | undefined>
  closeSession(sessionId: string, closedAt: string): Promise<void>
  startAttempt(input: {
    id: string
    sessionId: string
    familyId: string
    kidId: string
    questionId: string
    startedAt: string
  }): Promise<'started' | 'existing' | 'conflict'>
  findAttempt(attemptId: string): Promise<TrainingAttempt | undefined>
  findOpenAttempt(sessionId: string): Promise<TrainingAttempt | undefined>
  setHintLevel(attemptId: string, level: 1 | 2 | 3): Promise<void>
  findAnswerSubmission(
    submissionId: string,
  ): Promise<RecordAnswerInput | undefined>
  recordAnswer(
    input: RecordAnswerInput,
  ): Promise<'recorded' | 'existing' | 'conflict'>
  listAnswerEvidence(
    familyId: string,
    kidId: string,
  ): Promise<AnswerEvidence[]>
  completeAttempt(attemptId: string, completedAt: string): Promise<void>
  hasOpenAttempt(sessionId: string): Promise<boolean>
  close(): Promise<void>
}

export class InMemoryTrainingStateRepository
  implements TrainingStateRepository
{
  private readonly sessions = new Map<string, TrainingSession>()
  private readonly attempts = new Map<string, TrainingAttempt>()
  private readonly answers = new Map<string, RecordAnswerInput>()

  async getOrCreateSession(
    familyId: string,
    kidId: string,
    localDate: string,
    startedAt: string,
  ): Promise<TrainingSession> {
    const key = `${familyId}:${kidId}:${localDate}`
    const existing = this.sessions.get(key)
    if (existing) return structuredClone(existing)
    const session = { id: randomUUID(), familyId, kidId, localDate, startedAt }
    this.sessions.set(key, session)
    return structuredClone(session)
  }

  async findSession(familyId: string, kidId: string, localDate: string) {
    const session = this.sessions.get(`${familyId}:${kidId}:${localDate}`)
    return session ? structuredClone(session) : undefined
  }

  async closeSession(sessionId: string, closedAt: string): Promise<void> {
    for (const [key, session] of this.sessions) {
      if (session.id === sessionId && !session.closedAt) {
        this.sessions.set(key, { ...session, closedAt })
        return
      }
    }
  }

  async startAttempt(
    input: Omit<TrainingAttempt, 'hintLevel' | 'completedAt'>,
  ): Promise<'started' | 'existing' | 'conflict'> {
    const existing = this.attempts.get(input.id)
    if (existing) {
      return existing.sessionId === input.sessionId &&
        existing.familyId === input.familyId &&
        existing.kidId === input.kidId &&
        existing.questionId === input.questionId
        ? 'existing'
        : 'conflict'
    }
    this.attempts.set(input.id, { ...input, hintLevel: 0 })
    return 'started'
  }

  async findAttempt(attemptId: string) {
    const attempt = this.attempts.get(attemptId)
    return attempt ? structuredClone(attempt) : undefined
  }

  async findOpenAttempt(sessionId: string) {
    const attempt = [...this.attempts.values()]
      .filter((item) => item.sessionId === sessionId && !item.completedAt)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]
    return attempt ? structuredClone(attempt) : undefined
  }

  async setHintLevel(attemptId: string, level: 1 | 2 | 3): Promise<void> {
    const attempt = this.attempts.get(attemptId)
    if (attempt) this.attempts.set(attemptId, { ...attempt, hintLevel: level })
  }

  async findAnswerSubmission(submissionId: string) {
    const answer = this.answers.get(submissionId)
    return answer ? structuredClone(answer) : undefined
  }

  async recordAnswer(
    input: RecordAnswerInput,
  ): Promise<'recorded' | 'existing' | 'conflict'> {
    const existing = this.answers.get(input.id)
    if (existing) {
      return JSON.stringify(existing) === JSON.stringify(input)
        ? 'existing'
        : 'conflict'
    }
    this.answers.set(input.id, structuredClone(input))
    return 'recorded'
  }

  async listAnswerEvidence(
    familyId: string,
    kidId: string,
  ): Promise<AnswerEvidence[]> {
    return [...this.answers.values()]
      .filter(
        (answer) =>
          answer.familyId === familyId && answer.kidId === kidId,
      )
      .sort(
        (left, right) =>
          left.submittedAt.localeCompare(right.submittedAt) ||
          left.id.localeCompare(right.id),
      )
      .map(({ answer: _, ...evidence }) => structuredClone(evidence))
  }

  async completeAttempt(
    attemptId: string,
    completedAt: string,
  ): Promise<void> {
    const attempt = this.attempts.get(attemptId)
    if (attempt && !attempt.completedAt) {
      this.attempts.set(attemptId, { ...attempt, completedAt })
    }
  }

  async hasOpenAttempt(sessionId: string): Promise<boolean> {
    return [...this.attempts.values()].some(
      (attempt) => attempt.sessionId === sessionId && !attempt.completedAt,
    )
  }

  async close(): Promise<void> {}
}

interface SessionRow {
  id: string
  family_id: string
  kid_id: string
  local_date: Date | string
  started_at: Date
  closed_at: Date | null
}

interface AttemptRow {
  id: string
  session_id: string
  family_id: string
  kid_id: string
  question_id: string
  hint_level: 0 | 1 | 2 | 3
  started_at: Date
  completed_at: Date | null
}

interface AnswerRow {
  id: string
  attempt_id: string
  family_id: string
  kid_id: string
  question_id: string
  kp_id: string
  answer: string
  correct: boolean
  hint_level: 0 | 1 | 2 | 3
  duration_ms: number | null
  submitted_at: Date
}

export class PostgresTrainingStateRepository
  implements TrainingStateRepository
{
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 })
  }

  async getOrCreateSession(
    familyId: string,
    kidId: string,
    localDate: string,
    startedAt: string,
  ): Promise<TrainingSession> {
    const result = await this.pool.query<SessionRow>(
      `insert into training_session (
         id, family_id, kid_id, local_date, started_at
       ) values ($1, $2, $3, $4::date, $5)
       on conflict (family_id, kid_id, local_date) do update
         set local_date = excluded.local_date
       returning id, family_id, kid_id, local_date, started_at, closed_at`,
      [randomUUID(), familyId, kidId, localDate, startedAt],
    )
    return toSession(result.rows[0]!)
  }

  async findSession(familyId: string, kidId: string, localDate: string) {
    const result = await this.pool.query<SessionRow>(
      `select id, family_id, kid_id, local_date, started_at, closed_at
         from training_session
        where family_id = $1 and kid_id = $2 and local_date = $3::date`,
      [familyId, kidId, localDate],
    )
    return result.rows[0] ? toSession(result.rows[0]) : undefined
  }

  async closeSession(sessionId: string, closedAt: string): Promise<void> {
    await this.pool.query(
      `update training_session
          set closed_at = coalesce(closed_at, $2), updated_at = now()
        where id = $1`,
      [sessionId, closedAt],
    )
  }

  async startAttempt(
    input: Omit<TrainingAttempt, 'hintLevel' | 'completedAt'>,
  ): Promise<'started' | 'existing' | 'conflict'> {
    const result = await this.pool.query(
      `insert into training_attempt (
         id, session_id, family_id, kid_id, question_id, started_at
       ) values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing returning id`,
      [
        input.id,
        input.sessionId,
        input.familyId,
        input.kidId,
        input.questionId,
        input.startedAt,
      ],
    )
    if (result.rowCount) return 'started'
    const existing = await this.findAttempt(input.id)
    return existing &&
      existing.sessionId === input.sessionId &&
      existing.familyId === input.familyId &&
      existing.kidId === input.kidId &&
      existing.questionId === input.questionId
      ? 'existing'
      : 'conflict'
  }

  async findAttempt(attemptId: string) {
    const result = await this.pool.query<AttemptRow>(
      `${attemptSelect} where id = $1`,
      [attemptId],
    )
    return result.rows[0] ? toAttempt(result.rows[0]) : undefined
  }

  async findOpenAttempt(sessionId: string) {
    const result = await this.pool.query<AttemptRow>(
      `${attemptSelect}
        where session_id = $1 and completed_at is null
        order by started_at desc limit 1`,
      [sessionId],
    )
    return result.rows[0] ? toAttempt(result.rows[0]) : undefined
  }

  async setHintLevel(attemptId: string, level: 1 | 2 | 3): Promise<void> {
    await this.pool.query(
      `update training_attempt
          set hint_level = greatest(hint_level, $2), updated_at = now()
        where id = $1`,
      [attemptId, level],
    )
  }

  async findAnswerSubmission(submissionId: string) {
    const result = await this.pool.query<AnswerRow>(
      `${answerSelect} where id = $1`,
      [submissionId],
    )
    return result.rows[0] ? toRecordAnswer(result.rows[0]) : undefined
  }

  async recordAnswer(
    input: RecordAnswerInput,
  ): Promise<'recorded' | 'existing' | 'conflict'> {
    const inserted = await this.pool.query(
      `insert into training_answer_submission (
         id, attempt_id, family_id, kid_id, question_id, kp_id,
         answer, correct, hint_level, duration_ms, submitted_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do nothing
       returning id`,
      [
        input.id,
        input.attemptId,
        input.familyId,
        input.kidId,
        input.questionId,
        input.kpId,
        input.answer,
        input.correct,
        input.hintLevel,
        input.durationMs ?? null,
        input.submittedAt,
      ],
    )
    if (inserted.rowCount) return 'recorded'

    const existing = await this.pool.query<AnswerRow>(
      `${answerSelect} where id = $1`,
      [input.id],
    )
    const row = existing.rows[0]
    if (!row) return 'conflict'
    return sameAnswer(toRecordAnswer(row), input) ? 'existing' : 'conflict'
  }

  async listAnswerEvidence(
    familyId: string,
    kidId: string,
  ): Promise<AnswerEvidence[]> {
    const result = await this.pool.query<AnswerRow>(
      `${answerSelect}
        where family_id = $1 and kid_id = $2
        order by submitted_at, id`,
      [familyId, kidId],
    )
    return result.rows.map(({ answer: _, ...row }) => toAnswerEvidence(row))
  }

  async completeAttempt(
    attemptId: string,
    completedAt: string,
  ): Promise<void> {
    await this.pool.query(
      `update training_attempt
          set completed_at = coalesce(completed_at, $2), updated_at = now()
        where id = $1`,
      [attemptId, completedAt],
    )
  }

  async hasOpenAttempt(sessionId: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from training_attempt
        where session_id = $1 and completed_at is null limit 1`,
      [sessionId],
    )
    return Boolean(result.rowCount)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

const attemptSelect = `
  select id, session_id, family_id, kid_id, question_id,
         hint_level, started_at, completed_at
    from training_attempt
`

const answerSelect = `
  select id, attempt_id, family_id, kid_id, question_id, kp_id,
         answer, correct, hint_level, duration_ms, submitted_at
    from training_answer_submission
`

function toSession(row: SessionRow): TrainingSession {
  return {
    id: row.id,
    familyId: row.family_id,
    kidId: row.kid_id,
    localDate:
      row.local_date instanceof Date
        ? row.local_date.toISOString().slice(0, 10)
        : row.local_date,
    startedAt: row.started_at.toISOString(),
    ...(row.closed_at ? { closedAt: row.closed_at.toISOString() } : {}),
  }
}

function toAttempt(row: AttemptRow): TrainingAttempt {
  return {
    id: row.id,
    sessionId: row.session_id,
    familyId: row.family_id,
    kidId: row.kid_id,
    questionId: row.question_id,
    hintLevel: row.hint_level,
    startedAt: row.started_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  }
}

function toRecordAnswer(row: AnswerRow): RecordAnswerInput {
  return {
    ...toAnswerEvidence(row),
    answer: row.answer,
  }
}

function toAnswerEvidence(
  row: Omit<AnswerRow, 'answer'>,
): AnswerEvidence {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    familyId: row.family_id,
    kidId: row.kid_id,
    questionId: row.question_id,
    kpId: row.kp_id,
    correct: row.correct,
    hintLevel: row.hint_level,
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    submittedAt: row.submitted_at.toISOString(),
  }
}

function sameAnswer(
  left: RecordAnswerInput,
  right: RecordAnswerInput,
): boolean {
  return (
    left.id === right.id &&
    left.attemptId === right.attemptId &&
    left.familyId === right.familyId &&
    left.kidId === right.kidId &&
    left.questionId === right.questionId &&
    left.kpId === right.kpId &&
    left.answer === right.answer &&
    left.correct === right.correct &&
    left.hintLevel === right.hintLevel &&
    left.durationMs === right.durationMs &&
    left.submittedAt === right.submittedAt
  )
}
