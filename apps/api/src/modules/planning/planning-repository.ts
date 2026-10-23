import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

export type TaskSource = 'parent' | 'school' | 'system'
export type TaskKind =
  | 'homework'
  | 'preview'
  | 'review'
  | 'carry_reminder'
  | 'practice'
export type TaskStatus = 'pending' | 'claimed_done' | 'verified' | 'cancelled'
export type ProgressSource =
  | 'parent'
  | 'schedule_ocr'
  | 'school_task_ocr'
  | 'system'
export type MappingStatus = 'mapped' | 'unmapped' | 'confirmed'
export type ReviewStage = 't1' | 't3' | 't14' | 'maintenance'

export interface LearningTask {
  id: string
  familyId: string
  kidId: string
  source: TaskSource
  kind: TaskKind
  title: string
  description: string
  subject: string
  kpId?: string
  dueAt?: string
  estimatedMinutes: number
  priority: 1 | 2 | 3
  status: TaskStatus
  createdBy: string
  claimedDoneAt?: string
  verifiedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CurriculumProgress {
  id: string
  familyId: string
  kidId: string
  subject: string
  chapter: string
  kpId?: string
  source: ProgressSource
  confidence: number
  mappingStatus: MappingStatus
  effectiveDate: string
  confirmedBy?: string
  confirmedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ReviewSchedule {
  id: string
  familyId: string
  kidId: string
  kpId: string
  questionId: string
  sourceSubmissionId?: string
  stage: ReviewStage
  dueAt: string
  status: 'pending' | 'completed' | 'superseded'
  completedSubmissionId?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface PlanningRepository {
  createTask(
    input: Omit<
      LearningTask,
      | 'id'
      | 'status'
      | 'claimedDoneAt'
      | 'verifiedAt'
      | 'createdAt'
      | 'updatedAt'
    >,
  ): Promise<LearningTask>
  listTasks(familyId: string, kidId: string): Promise<LearningTask[]>
  changeTaskStatus(
    familyId: string,
    kidId: string,
    id: string,
    status: TaskStatus,
    now: string,
  ): Promise<LearningTask | undefined>
  createProgress(
    input: Omit<
      CurriculumProgress,
      'id' | 'confirmedBy' | 'confirmedAt' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<CurriculumProgress>
  listProgress(
    familyId: string,
    kidId: string,
  ): Promise<CurriculumProgress[]>
  confirmProgress(
    familyId: string,
    kidId: string,
    id: string,
    parentId: string,
    kpId: string,
    now: string,
  ): Promise<CurriculumProgress | undefined>
  findPendingReview(
    familyId: string,
    kidId: string,
    questionId: string,
  ): Promise<ReviewSchedule | undefined>
  saveReview(input: {
    familyId: string
    kidId: string
    kpId: string
    questionId: string
    sourceSubmissionId?: string
    stage: ReviewStage
    dueAt: string
  }): Promise<ReviewSchedule>
  finishReview(input: {
    familyId: string
    id: string
    submissionId: string
    status: 'completed' | 'superseded'
    completedAt: string
  }): Promise<void>
  listDueReviews(
    familyId: string,
    kidId: string,
    dueBefore: string,
  ): Promise<ReviewSchedule[]>
  close(): Promise<void>
}

export class InMemoryPlanningRepository implements PlanningRepository {
  private readonly tasks = new Map<string, LearningTask>()
  private readonly progress = new Map<string, CurriculumProgress>()
  private readonly reviews = new Map<string, ReviewSchedule>()

  async createTask(
    input: Omit<
      LearningTask,
      | 'id'
      | 'status'
      | 'claimedDoneAt'
      | 'verifiedAt'
      | 'createdAt'
      | 'updatedAt'
    >,
  ): Promise<LearningTask> {
    const now = new Date().toISOString()
    const task: LearningTask = {
      ...structuredClone(input),
      id: randomUUID(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(task.id, task)
    return structuredClone(task)
  }

  async listTasks(familyId: string, kidId: string): Promise<LearningTask[]> {
    return [...this.tasks.values()]
      .filter((item) => item.familyId === familyId && item.kidId === kidId)
      .sort(
        (left, right) =>
          statusOrder(left.status) - statusOrder(right.status) ||
          (left.dueAt ?? '9999').localeCompare(right.dueAt ?? '9999') ||
          left.priority - right.priority,
      )
      .map((item) => structuredClone(item))
  }

  async changeTaskStatus(
    familyId: string,
    kidId: string,
    id: string,
    status: TaskStatus,
    now: string,
  ): Promise<LearningTask | undefined> {
    const task = this.tasks.get(id)
    if (!task || task.familyId !== familyId || task.kidId !== kidId) {
      return undefined
    }
    const updated: LearningTask = {
      ...task,
      status,
      ...(status === 'claimed_done' ? { claimedDoneAt: now } : {}),
      ...(status === 'verified' ? { verifiedAt: now } : {}),
      updatedAt: now,
    }
    this.tasks.set(id, updated)
    return structuredClone(updated)
  }

  async createProgress(
    input: Omit<
      CurriculumProgress,
      'id' | 'confirmedBy' | 'confirmedAt' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<CurriculumProgress> {
    const now = new Date().toISOString()
    const item: CurriculumProgress = {
      ...structuredClone(input),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.progress.set(item.id, item)
    return structuredClone(item)
  }

  async listProgress(
    familyId: string,
    kidId: string,
  ): Promise<CurriculumProgress[]> {
    return [...this.progress.values()]
      .filter((item) => item.familyId === familyId && item.kidId === kidId)
      .sort(
        (left, right) =>
          right.effectiveDate.localeCompare(left.effectiveDate) ||
          right.createdAt.localeCompare(left.createdAt),
      )
      .map((item) => structuredClone(item))
  }

  async confirmProgress(
    familyId: string,
    kidId: string,
    id: string,
    parentId: string,
    kpId: string,
    now: string,
  ): Promise<CurriculumProgress | undefined> {
    const item = this.progress.get(id)
    if (!item || item.familyId !== familyId || item.kidId !== kidId) {
      return undefined
    }
    const confirmed: CurriculumProgress = {
      ...item,
      kpId,
      confidence: 1,
      mappingStatus: 'confirmed',
      confirmedBy: parentId,
      confirmedAt: now,
      updatedAt: now,
    }
    this.progress.set(id, confirmed)
    return structuredClone(confirmed)
  }

  async findPendingReview(
    familyId: string,
    kidId: string,
    questionId: string,
  ): Promise<ReviewSchedule | undefined> {
    const item = [...this.reviews.values()].find(
      (review) =>
        review.familyId === familyId &&
        review.kidId === kidId &&
        review.questionId === questionId &&
        review.status === 'pending',
    )
    return item ? structuredClone(item) : undefined
  }

  async saveReview(input: {
    familyId: string
    kidId: string
    kpId: string
    questionId: string
    sourceSubmissionId?: string
    stage: ReviewStage
    dueAt: string
  }): Promise<ReviewSchedule> {
    const existing = await this.findPendingReview(
      input.familyId,
      input.kidId,
      input.questionId,
    )
    if (existing) return existing
    const now = new Date().toISOString()
    const review: ReviewSchedule = {
      id: randomUUID(),
      ...structuredClone(input),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    this.reviews.set(review.id, review)
    return structuredClone(review)
  }

  async finishReview(input: {
    familyId: string
    id: string
    submissionId: string
    status: 'completed' | 'superseded'
    completedAt: string
  }): Promise<void> {
    const item = this.reviews.get(input.id)
    if (!item || item.familyId !== input.familyId || item.status !== 'pending') {
      return
    }
    this.reviews.set(input.id, {
      ...item,
      status: input.status,
      completedSubmissionId: input.submissionId,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    })
  }

  async listDueReviews(
    familyId: string,
    kidId: string,
    dueBefore: string,
  ): Promise<ReviewSchedule[]> {
    return [...this.reviews.values()]
      .filter(
        (item) =>
          item.familyId === familyId &&
          item.kidId === kidId &&
          item.status === 'pending' &&
          item.dueAt <= dueBefore,
      )
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
      .map((item) => structuredClone(item))
  }

  async close(): Promise<void> {}
}

export class PostgresPlanningRepository implements PlanningRepository {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 })
  }

  async createTask(
    input: Omit<
      LearningTask,
      | 'id'
      | 'status'
      | 'claimedDoneAt'
      | 'verifiedAt'
      | 'createdAt'
      | 'updatedAt'
    >,
  ): Promise<LearningTask> {
    const result = await this.pool.query<TaskRow>(
      `insert into learning_task (
         id, family_id, kid_id, source, kind, title, description, subject,
         kp_id, due_at, estimated_minutes, priority, created_by
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
       )
       returning ${taskColumns}`,
      [
        randomUUID(),
        input.familyId,
        input.kidId,
        input.source,
        input.kind,
        input.title,
        input.description,
        input.subject,
        input.kpId ?? null,
        input.dueAt ?? null,
        input.estimatedMinutes,
        input.priority,
        input.createdBy,
      ],
    )
    return toTask(result.rows[0]!)
  }

  async listTasks(familyId: string, kidId: string): Promise<LearningTask[]> {
    const result = await this.pool.query<TaskRow>(
      `select ${taskColumns}
         from learning_task
        where family_id = $1 and kid_id = $2
        order by
          case status
            when 'pending' then 0
            when 'claimed_done' then 1
            when 'verified' then 2
            else 3
          end,
          due_at nulls last, priority, created_at desc`,
      [familyId, kidId],
    )
    return result.rows.map(toTask)
  }

  async changeTaskStatus(
    familyId: string,
    kidId: string,
    id: string,
    status: TaskStatus,
    now: string,
  ): Promise<LearningTask | undefined> {
    const result = await this.pool.query<TaskRow>(
      `update learning_task
          set status = $4,
              claimed_done_at = case
                when $4 = 'claimed_done' then $5
                else claimed_done_at
              end,
              verified_at = case
                when $4 = 'verified' then $5
                else verified_at
              end,
              updated_at = $5
        where family_id = $1 and kid_id = $2 and id = $3
        returning ${taskColumns}`,
      [familyId, kidId, id, status, now],
    )
    return result.rows[0] ? toTask(result.rows[0]) : undefined
  }

  async createProgress(
    input: Omit<
      CurriculumProgress,
      'id' | 'confirmedBy' | 'confirmedAt' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<CurriculumProgress> {
    const result = await this.pool.query<ProgressRow>(
      `insert into curriculum_progress (
         id, family_id, kid_id, subject, chapter, kp_id, source,
         confidence, mapping_status, effective_date
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date)
       returning ${progressColumns}`,
      [
        randomUUID(),
        input.familyId,
        input.kidId,
        input.subject,
        input.chapter,
        input.kpId ?? null,
        input.source,
        input.confidence,
        input.mappingStatus,
        input.effectiveDate,
      ],
    )
    return toProgress(result.rows[0]!)
  }

  async listProgress(
    familyId: string,
    kidId: string,
  ): Promise<CurriculumProgress[]> {
    const result = await this.pool.query<ProgressRow>(
      `select ${progressColumns}
         from curriculum_progress
        where family_id = $1 and kid_id = $2
        order by effective_date desc, created_at desc`,
      [familyId, kidId],
    )
    return result.rows.map(toProgress)
  }

  async confirmProgress(
    familyId: string,
    kidId: string,
    id: string,
    parentId: string,
    kpId: string,
    now: string,
  ): Promise<CurriculumProgress | undefined> {
    const result = await this.pool.query<ProgressRow>(
      `update curriculum_progress
          set kp_id = $5, confidence = 1, mapping_status = 'confirmed',
              confirmed_by = $4, confirmed_at = $6, updated_at = $6
        where family_id = $1 and kid_id = $2 and id = $3
        returning ${progressColumns}`,
      [familyId, kidId, id, parentId, kpId, now],
    )
    return result.rows[0] ? toProgress(result.rows[0]) : undefined
  }

  async findPendingReview(
    familyId: string,
    kidId: string,
    questionId: string,
  ): Promise<ReviewSchedule | undefined> {
    const result = await this.pool.query<ReviewRow>(
      `select ${reviewColumns}
         from review_schedule
        where family_id = $1 and kid_id = $2 and question_id = $3
          and status = 'pending'
        limit 1`,
      [familyId, kidId, questionId],
    )
    return result.rows[0] ? toReview(result.rows[0]) : undefined
  }

  async saveReview(input: {
    familyId: string
    kidId: string
    kpId: string
    questionId: string
    sourceSubmissionId?: string
    stage: ReviewStage
    dueAt: string
  }): Promise<ReviewSchedule> {
    const result = await this.pool.query<ReviewRow>(
      `insert into review_schedule (
         id, family_id, kid_id, kp_id, question_id,
         source_submission_id, stage, due_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (family_id, kid_id, question_id)
         where status = 'pending'
       do update set updated_at = review_schedule.updated_at
       returning ${reviewColumns}`,
      [
        randomUUID(),
        input.familyId,
        input.kidId,
        input.kpId,
        input.questionId,
        input.sourceSubmissionId ?? null,
        input.stage,
        input.dueAt,
      ],
    )
    return toReview(result.rows[0]!)
  }

  async finishReview(input: {
    familyId: string
    id: string
    submissionId: string
    status: 'completed' | 'superseded'
    completedAt: string
  }): Promise<void> {
    await this.pool.query(
      `update review_schedule
          set status = $3, completed_submission_id = $4,
              completed_at = $5, updated_at = $5
        where family_id = $1 and id = $2 and status = 'pending'`,
      [
        input.familyId,
        input.id,
        input.status,
        input.submissionId,
        input.completedAt,
      ],
    )
  }

  async listDueReviews(
    familyId: string,
    kidId: string,
    dueBefore: string,
  ): Promise<ReviewSchedule[]> {
    const result = await this.pool.query<ReviewRow>(
      `select ${reviewColumns}
         from review_schedule
        where family_id = $1 and kid_id = $2 and status = 'pending'
          and due_at <= $3
        order by due_at`,
      [familyId, kidId, dueBefore],
    )
    return result.rows.map(toReview)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

interface TaskRow {
  id: string
  family_id: string
  kid_id: string
  source: TaskSource
  kind: TaskKind
  title: string
  description: string
  subject: string
  kp_id: string | null
  due_at: Date | null
  estimated_minutes: number
  priority: 1 | 2 | 3
  status: TaskStatus
  created_by: string
  claimed_done_at: Date | null
  verified_at: Date | null
  created_at: Date
  updated_at: Date
}

interface ProgressRow {
  id: string
  family_id: string
  kid_id: string
  subject: string
  chapter: string
  kp_id: string | null
  source: ProgressSource
  confidence: string
  mapping_status: MappingStatus
  effective_date: Date | string
  confirmed_by: string | null
  confirmed_at: Date | null
  created_at: Date
  updated_at: Date
}

interface ReviewRow {
  id: string
  family_id: string
  kid_id: string
  kp_id: string
  question_id: string
  source_submission_id: string | null
  stage: ReviewStage
  due_at: Date
  status: 'pending' | 'completed' | 'superseded'
  completed_submission_id: string | null
  completed_at: Date | null
  created_at: Date
  updated_at: Date
}

const taskColumns = `
  id, family_id, kid_id, source, kind, title, description, subject, kp_id,
  due_at, estimated_minutes, priority, status, created_by, claimed_done_at,
  verified_at, created_at, updated_at
`
const progressColumns = `
  id, family_id, kid_id, subject, chapter, kp_id, source, confidence,
  mapping_status, effective_date, confirmed_by, confirmed_at,
  created_at, updated_at
`
const reviewColumns = `
  id, family_id, kid_id, kp_id, question_id, source_submission_id,
  stage, due_at, status, completed_submission_id, completed_at,
  created_at, updated_at
`

function toTask(row: TaskRow): LearningTask {
  return {
    id: row.id,
    familyId: row.family_id,
    kidId: row.kid_id,
    source: row.source,
    kind: row.kind,
    title: row.title,
    description: row.description,
    subject: row.subject,
    ...(row.kp_id ? { kpId: row.kp_id } : {}),
    ...(row.due_at ? { dueAt: row.due_at.toISOString() } : {}),
    estimatedMinutes: row.estimated_minutes,
    priority: row.priority,
    status: row.status,
    createdBy: row.created_by,
    ...(row.claimed_done_at
      ? { claimedDoneAt: row.claimed_done_at.toISOString() }
      : {}),
    ...(row.verified_at ? { verifiedAt: row.verified_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toProgress(row: ProgressRow): CurriculumProgress {
  return {
    id: row.id,
    familyId: row.family_id,
    kidId: row.kid_id,
    subject: row.subject,
    chapter: row.chapter,
    ...(row.kp_id ? { kpId: row.kp_id } : {}),
    source: row.source,
    confidence: Number(row.confidence),
    mappingStatus: row.mapping_status,
    effectiveDate:
      row.effective_date instanceof Date
        ? row.effective_date.toISOString().slice(0, 10)
        : row.effective_date,
    ...(row.confirmed_by ? { confirmedBy: row.confirmed_by } : {}),
    ...(row.confirmed_at
      ? { confirmedAt: row.confirmed_at.toISOString() }
      : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toReview(row: ReviewRow): ReviewSchedule {
  return {
    id: row.id,
    familyId: row.family_id,
    kidId: row.kid_id,
    kpId: row.kp_id,
    questionId: row.question_id,
    ...(row.source_submission_id
      ? { sourceSubmissionId: row.source_submission_id }
      : {}),
    stage: row.stage,
    dueAt: row.due_at.toISOString(),
    status: row.status,
    ...(row.completed_submission_id
      ? { completedSubmissionId: row.completed_submission_id }
      : {}),
    ...(row.completed_at
      ? { completedAt: row.completed_at.toISOString() }
      : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function statusOrder(status: TaskStatus): number {
  return {
    pending: 0,
    claimed_done: 1,
    verified: 2,
    cancelled: 3,
  }[status]
}
