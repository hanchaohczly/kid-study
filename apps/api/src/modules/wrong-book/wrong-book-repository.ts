import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'

export type WrongItemSource = 'system' | 'photo'
export type WrongItemStatus = 'active' | 'mastered' | 'archived'
export type WrongItemMappingMethod = 'question' | 'vision' | 'manual'

export interface WrongItem {
  id: string
  familyId: string
  kidId: string
  source: WrongItemSource
  questionId?: string
  kpId?: string
  knowledgePointName?: string
  chapter?: string
  stem: string
  studentAnswer?: string
  answerKey?: string
  analysis?: string
  hasPhoto: boolean
  mappingConfidence?: number
  mappingMethod: WrongItemMappingMethod
  mappingConfirmed: boolean
  status: WrongItemStatus
  tags: string[]
  note: string
  wrongCount: number
  reviewCount: number
  correctReviewStreak: number
  firstWrongAt: string
  latestWrongAt: string
  nextReviewAt?: string
  createdAt: string
  updatedAt: string
}

export interface CaptureSystemWrongInput {
  familyId: string
  kidId: string
  submissionId: string
  questionId: string
  kpId: string
  stem: string
  studentAnswer: string
  answerKey: string
  analysis: string
  occurredAt: string
}

export interface CreatePhotoWrongInput {
  familyId: string
  kidId: string
  kpId: string
  stem: string
  studentAnswer?: string
  answerKey: string
  analysis: string
  photoMimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  photoData: Buffer
  mappingConfidence: number
  occurredAt: string
}

export interface UpdateWrongItemInput {
  status?: WrongItemStatus
  kpId?: string
  tags?: string[]
  note?: string
}

export interface WrongItemPhoto {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  data: Buffer
}

export interface WrongBookRepository {
  captureSystemWrong(input: CaptureSystemWrongInput): Promise<WrongItem>
  createPhotoWrong(input: CreatePhotoWrongInput): Promise<WrongItem>
  list(
    familyId: string,
    kidId: string,
    status?: WrongItemStatus,
  ): Promise<WrongItem[]>
  find(
    familyId: string,
    kidId: string,
    id: string,
  ): Promise<WrongItem | undefined>
  getPhoto(
    familyId: string,
    kidId: string,
    id: string,
  ): Promise<WrongItemPhoto | undefined>
  update(
    familyId: string,
    kidId: string,
    id: string,
    input: UpdateWrongItemInput,
  ): Promise<WrongItem | undefined>
  remove(familyId: string, kidId: string, id: string): Promise<boolean>
  recordReview(input: {
    familyId: string
    kidId: string
    wrongItemId: string
    reviewedBy: string
    result: 'correct' | 'incorrect'
    reviewedAt: string
  }): Promise<WrongItem | undefined>
  close(): Promise<void>
}

interface StoredWrongItem extends WrongItem {
  photo?: WrongItemPhoto
}

export class InMemoryWrongBookRepository implements WrongBookRepository {
  private readonly items = new Map<string, StoredWrongItem>()
  private readonly occurrences = new Set<string>()

  async captureSystemWrong(
    input: CaptureSystemWrongInput,
  ): Promise<WrongItem> {
    const occurrenceKey = `${input.familyId}:${input.submissionId}`
    const existing = [...this.items.values()].find(
      (item) =>
        item.familyId === input.familyId &&
        item.kidId === input.kidId &&
        item.source === 'system' &&
        item.questionId === input.questionId,
    )
    if (existing && this.occurrences.has(occurrenceKey)) {
      return publicItem(existing)
    }

    this.occurrences.add(occurrenceKey)
    if (existing) {
      existing.studentAnswer = input.studentAnswer
      existing.answerKey = input.answerKey
      existing.analysis = input.analysis
      existing.wrongCount += 1
      existing.latestWrongAt = input.occurredAt
      existing.status = 'active'
      existing.updatedAt = input.occurredAt
      return publicItem(existing)
    }

    const item: StoredWrongItem = {
      id: randomUUID(),
      familyId: input.familyId,
      kidId: input.kidId,
      source: 'system',
      questionId: input.questionId,
      kpId: input.kpId,
      stem: input.stem,
      studentAnswer: input.studentAnswer,
      answerKey: input.answerKey,
      analysis: input.analysis,
      hasPhoto: false,
      mappingConfidence: 1,
      mappingMethod: 'question',
      mappingConfirmed: true,
      status: 'active',
      tags: [],
      note: '',
      wrongCount: 1,
      reviewCount: 0,
      correctReviewStreak: 0,
      firstWrongAt: input.occurredAt,
      latestWrongAt: input.occurredAt,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    }
    this.items.set(item.id, item)
    return publicItem(item)
  }

  async createPhotoWrong(input: CreatePhotoWrongInput): Promise<WrongItem> {
    const item: StoredWrongItem = {
      id: randomUUID(),
      familyId: input.familyId,
      kidId: input.kidId,
      source: 'photo',
      kpId: input.kpId,
      stem: input.stem,
      ...(input.studentAnswer ? { studentAnswer: input.studentAnswer } : {}),
      answerKey: input.answerKey,
      analysis: input.analysis,
      hasPhoto: true,
      photo: { mimeType: input.photoMimeType, data: input.photoData },
      mappingConfidence: input.mappingConfidence,
      mappingMethod: 'vision',
      mappingConfirmed: false,
      status: 'active',
      tags: [],
      note: '',
      wrongCount: 1,
      reviewCount: 0,
      correctReviewStreak: 0,
      firstWrongAt: input.occurredAt,
      latestWrongAt: input.occurredAt,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    }
    this.items.set(item.id, item)
    return publicItem(item)
  }

  async list(
    familyId: string,
    kidId: string,
    status?: WrongItemStatus,
  ): Promise<WrongItem[]> {
    return [...this.items.values()]
      .filter(
        (item) =>
          item.familyId === familyId &&
          item.kidId === kidId &&
          (!status || item.status === status),
      )
      .sort((left, right) => right.latestWrongAt.localeCompare(left.latestWrongAt))
      .map(publicItem)
  }

  async find(familyId: string, kidId: string, id: string) {
    const item = this.items.get(id)
    return item?.familyId === familyId && item.kidId === kidId
      ? publicItem(item)
      : undefined
  }

  async getPhoto(familyId: string, kidId: string, id: string) {
    const item = this.items.get(id)
    if (
      !item ||
      item.familyId !== familyId ||
      item.kidId !== kidId ||
      !item.photo
    ) {
      return undefined
    }
    return {
      mimeType: item.photo.mimeType,
      data: Buffer.from(item.photo.data),
    }
  }

  async update(
    familyId: string,
    kidId: string,
    id: string,
    input: UpdateWrongItemInput,
  ) {
    const item = this.items.get(id)
    if (!item || item.familyId !== familyId || item.kidId !== kidId) {
      return undefined
    }
    if (input.status) item.status = input.status
    if (input.kpId) {
      item.kpId = input.kpId
      item.mappingMethod = 'manual'
      item.mappingConfidence = 1
      item.mappingConfirmed = true
    }
    if (input.tags) item.tags = [...input.tags]
    if (input.note !== undefined) item.note = input.note
    item.updatedAt = new Date().toISOString()
    return publicItem(item)
  }

  async remove(familyId: string, kidId: string, id: string): Promise<boolean> {
    const item = this.items.get(id)
    return Boolean(
      item &&
        item.familyId === familyId &&
        item.kidId === kidId &&
        this.items.delete(id),
    )
  }

  async recordReview(input: {
    familyId: string
    kidId: string
    wrongItemId: string
    reviewedBy: string
    result: 'correct' | 'incorrect'
    reviewedAt: string
  }) {
    const item = this.items.get(input.wrongItemId)
    if (
      !item ||
      item.familyId !== input.familyId ||
      item.kidId !== input.kidId
    ) {
      return undefined
    }
    item.reviewCount += 1
    item.correctReviewStreak =
      input.result === 'correct' ? item.correctReviewStreak + 1 : 0
    item.status =
      input.result === 'correct' && item.correctReviewStreak >= 2
        ? 'mastered'
        : 'active'
    if (item.status === 'mastered') {
      delete item.nextReviewAt
    } else {
      item.nextReviewAt = new Date(
        new Date(input.reviewedAt).getTime() +
          (input.result === 'correct' ? 3 : 1) * 86_400_000,
      ).toISOString()
    }
    item.updatedAt = input.reviewedAt
    return publicItem(item)
  }

  async close(): Promise<void> {}
}

interface WrongItemRow {
  id: string
  family_id: string
  kid_id: string
  source: WrongItemSource
  question_id: string | null
  kp_id: string | null
  knowledge_point_name: string | null
  chapter: string | null
  stem: string
  student_answer: string | null
  answer_key: string | null
  analysis: string | null
  has_photo: boolean
  mapping_confidence: string | number | null
  mapping_method: WrongItemMappingMethod
  mapping_confirmed: boolean
  status: WrongItemStatus
  tags: string[]
  note: string
  wrong_count: number
  review_count: number
  correct_review_streak: number
  first_wrong_at: Date
  latest_wrong_at: Date
  next_review_at: Date | null
  created_at: Date
  updated_at: Date
}

const wrongItemSelect = `
  select wi.id, wi.family_id, wi.kid_id, wi.source, wi.question_id,
         wi.kp_id, kp.name as knowledge_point_name, kp.chapter,
         wi.stem, wi.student_answer, wi.answer_key, wi.analysis,
         (wi.photo_data is not null) as has_photo,
         wi.mapping_confidence, wi.mapping_method, wi.mapping_confirmed,
         wi.status, wi.tags, wi.note, wi.wrong_count, wi.review_count,
         wi.correct_review_streak, wi.first_wrong_at, wi.latest_wrong_at,
         wi.next_review_at, wi.created_at, wi.updated_at
    from wrong_item wi
    left join knowledge_point kp
      on kp.family_id = wi.family_id and kp.id = wi.kp_id
`

export class PostgresWrongBookRepository implements WrongBookRepository {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 })
  }

  async captureSystemWrong(
    input: CaptureSystemWrongInput,
  ): Promise<WrongItem> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const insertedItem = await client.query<{ id: string }>(
        `insert into wrong_item (
           id, family_id, kid_id, source, question_id, kp_id, stem,
           student_answer, answer_key, analysis, mapping_confidence,
           mapping_method, mapping_confirmed, first_wrong_at, latest_wrong_at
         ) values (
           $1, $2, $3, 'system', $4, $5, $6, $7, $8, $9, 1,
           'question', true, $10, $10
         )
         on conflict (family_id, kid_id, question_id)
           where source = 'system' and question_id is not null
         do nothing
         returning id`,
        [
          randomUUID(),
          input.familyId,
          input.kidId,
          input.questionId,
          input.kpId,
          input.stem,
          input.studentAnswer,
          input.answerKey,
          input.analysis,
          input.occurredAt,
        ],
      )
      const created = Boolean(insertedItem.rowCount)
      const wrongItemId =
        insertedItem.rows[0]?.id ??
        (
          await client.query<{ id: string }>(
            `select id
               from wrong_item
              where family_id = $1 and kid_id = $2
                and source = 'system' and question_id = $3
              for update`,
            [input.familyId, input.kidId, input.questionId],
          )
        ).rows[0]!.id

      const occurrence = await client.query(
        `insert into wrong_item_occurrence (
           id, wrong_item_id, family_id, submission_id,
           student_answer, occurred_at
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (family_id, submission_id) do nothing
         returning id`,
        [
          randomUUID(),
          wrongItemId,
          input.familyId,
          input.submissionId,
          input.studentAnswer,
          input.occurredAt,
        ],
      )
      if (!created && occurrence.rowCount) {
        await client.query(
          `update wrong_item
              set student_answer = $2,
                  answer_key = $3,
                  analysis = $4,
                  wrong_count = wrong_count + 1,
                  latest_wrong_at = $5,
                  status = 'active',
                  updated_at = now()
            where id = $1`,
          [
            wrongItemId,
            input.studentAnswer,
            input.answerKey,
            input.analysis,
            input.occurredAt,
          ],
        )
      }
      const item = await this.selectOne(
        client,
        input.familyId,
        input.kidId,
        wrongItemId,
      )
      await client.query('commit')
      return toWrongItem(item!)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async createPhotoWrong(input: CreatePhotoWrongInput): Promise<WrongItem> {
    const id = randomUUID()
    await this.pool.query(
      `insert into wrong_item (
         id, family_id, kid_id, source, kp_id, stem, student_answer,
         answer_key, analysis, photo_mime_type, photo_data,
         mapping_confidence, mapping_method, mapping_confirmed,
         first_wrong_at, latest_wrong_at
       ) values (
         $1, $2, $3, 'photo', $4, $5, $6, $7, $8, $9, $10,
         $11, 'vision', false, $12, $12
       )`,
      [
        id,
        input.familyId,
        input.kidId,
        input.kpId,
        input.stem,
        input.studentAnswer ?? null,
        input.answerKey,
        input.analysis,
        input.photoMimeType,
        input.photoData,
        input.mappingConfidence,
        input.occurredAt,
      ],
    )
    return (await this.find(input.familyId, input.kidId, id))!
  }

  async list(
    familyId: string,
    kidId: string,
    status?: WrongItemStatus,
  ): Promise<WrongItem[]> {
    const result = await this.pool.query<WrongItemRow>(
      `${wrongItemSelect}
        where wi.family_id = $1 and wi.kid_id = $2
          and ($3::text is null or wi.status = $3)
        order by wi.latest_wrong_at desc, wi.id`,
      [familyId, kidId, status ?? null],
    )
    return result.rows.map(toWrongItem)
  }

  async find(familyId: string, kidId: string, id: string) {
    const item = await this.selectOne(this.pool, familyId, kidId, id)
    return item ? toWrongItem(item) : undefined
  }

  async getPhoto(familyId: string, kidId: string, id: string) {
    const result = await this.pool.query<{
      photo_mime_type: WrongItemPhoto['mimeType'] | null
      photo_data: Buffer | null
    }>(
      `select photo_mime_type, photo_data
         from wrong_item
        where family_id = $1 and kid_id = $2 and id = $3`,
      [familyId, kidId, id],
    )
    const row = result.rows[0]
    return row?.photo_mime_type && row.photo_data
      ? { mimeType: row.photo_mime_type, data: row.photo_data }
      : undefined
  }

  async update(
    familyId: string,
    kidId: string,
    id: string,
    input: UpdateWrongItemInput,
  ) {
    const result = await this.pool.query(
      `update wrong_item
          set status = coalesce($4, status),
              kp_id = coalesce($5, kp_id),
              tags = coalesce($6, tags),
              note = coalesce($7, note),
              mapping_method = case when $5::uuid is not null
                then 'manual' else mapping_method end,
              mapping_confidence = case when $5::uuid is not null
                then 1 else mapping_confidence end,
              mapping_confirmed = case when $5::uuid is not null
                then true else mapping_confirmed end,
              updated_at = now()
        where family_id = $1 and kid_id = $2 and id = $3
        returning id`,
      [
        familyId,
        kidId,
        id,
        input.status ?? null,
        input.kpId ?? null,
        input.tags ?? null,
        input.note ?? null,
      ],
    )
    return result.rowCount ? this.find(familyId, kidId, id) : undefined
  }

  async remove(familyId: string, kidId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      `delete from wrong_item
        where family_id = $1 and kid_id = $2 and id = $3`,
      [familyId, kidId, id],
    )
    return Boolean(result.rowCount)
  }

  async recordReview(input: {
    familyId: string
    kidId: string
    wrongItemId: string
    reviewedBy: string
    result: 'correct' | 'incorrect'
    reviewedAt: string
  }) {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const inserted = await client.query(
        `insert into wrong_item_review (
           id, wrong_item_id, family_id, kid_id, result,
           reviewed_by, reviewed_at
         )
         select $1, id, family_id, kid_id, $5, $6, $7
           from wrong_item
          where family_id = $2 and kid_id = $3 and id = $4
         returning id`,
        [
          randomUUID(),
          input.familyId,
          input.kidId,
          input.wrongItemId,
          input.result,
          input.reviewedBy,
          input.reviewedAt,
        ],
      )
      if (!inserted.rowCount) {
        await client.query('rollback')
        return undefined
      }
      await client.query(
        `update wrong_item
            set review_count = review_count + 1,
                correct_review_streak = case when $2 = 'correct'
                  then correct_review_streak + 1 else 0 end,
                status = case
                  when $2 = 'correct' and correct_review_streak + 1 >= 2
                    then 'mastered'
                  else 'active'
                end,
                next_review_at = case
                  when $2 = 'correct' and correct_review_streak + 1 >= 2
                    then null
                  when $2 = 'correct' then $3::timestamptz + interval '3 days'
                  else $3::timestamptz + interval '1 day'
                end,
                updated_at = now()
          where family_id = $4 and kid_id = $5 and id = $1`,
        [
          input.wrongItemId,
          input.result,
          input.reviewedAt,
          input.familyId,
          input.kidId,
        ],
      )
      const item = await this.selectOne(
        client,
        input.familyId,
        input.kidId,
        input.wrongItemId,
      )
      await client.query('commit')
      return item ? toWrongItem(item) : undefined
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

  private async selectOne(
    client: Pool | PoolClient,
    familyId: string,
    kidId: string,
    id: string,
  ): Promise<WrongItemRow | undefined> {
    const result = await client.query<WrongItemRow>(
      `${wrongItemSelect}
        where wi.family_id = $1 and wi.kid_id = $2 and wi.id = $3`,
      [familyId, kidId, id],
    )
    return result.rows[0]
  }
}

function publicItem(item: StoredWrongItem): WrongItem {
  const { photo: _, ...rest } = item
  return structuredClone(rest)
}

function toWrongItem(row: WrongItemRow): WrongItem {
  return {
    id: row.id,
    familyId: row.family_id,
    kidId: row.kid_id,
    source: row.source,
    ...(row.question_id ? { questionId: row.question_id } : {}),
    ...(row.kp_id ? { kpId: row.kp_id } : {}),
    ...(row.knowledge_point_name
      ? { knowledgePointName: row.knowledge_point_name }
      : {}),
    ...(row.chapter ? { chapter: row.chapter } : {}),
    stem: row.stem,
    ...(row.student_answer ? { studentAnswer: row.student_answer } : {}),
    ...(row.answer_key ? { answerKey: row.answer_key } : {}),
    ...(row.analysis ? { analysis: row.analysis } : {}),
    hasPhoto: row.has_photo,
    ...(row.mapping_confidence !== null
      ? { mappingConfidence: Number(row.mapping_confidence) }
      : {}),
    mappingMethod: row.mapping_method,
    mappingConfirmed: row.mapping_confirmed,
    status: row.status,
    tags: row.tags,
    note: row.note,
    wrongCount: row.wrong_count,
    reviewCount: row.review_count,
    correctReviewStreak: row.correct_review_streak,
    firstWrongAt: row.first_wrong_at.toISOString(),
    latestWrongAt: row.latest_wrong_at.toISOString(),
    ...(row.next_review_at
      ? { nextReviewAt: row.next_review_at.toISOString() }
      : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}
