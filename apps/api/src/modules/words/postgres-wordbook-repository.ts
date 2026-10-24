import { Pool } from 'pg'
import type {
  StoredWordAnswer,
  StoredWordEntry,
  WordAnswerRecord,
  WordWrongItem,
  Wordbook,
  WordbookRepository,
  WordQuiz,
  WordQuizQuestion,
} from './wordbook-service.js'
import { wordDraftEntrySchema } from './wordbook-service.js'

interface WordbookRow {
  id: string
  family_id: string
  name: string
  file_name: string
  source_type: Wordbook['sourceType']
  status: Wordbook['status']
  draft: unknown
  entry_count: number
  created_by: string
  created_at: Date
  confirmed_at: Date | null
}

interface WordEntryRow {
  id: string
  family_id: string
  wordbook_id: string
  word: string
  normalized_word: string
  phonetic: string
  part_of_speech: string
  meaning: string
  position: number
}

interface WordQuizRow {
  id: string
  family_id: string
  kid_id: string
  wordbook_id: string
  direction: WordQuiz['direction']
  delivery_mode: WordQuiz['deliveryMode']
  question_count: number
  status: WordQuiz['status']
  assigned_local_date: Date | string
  created_by: string
  created_at: Date
  completed_at: Date | null
}

interface WordQuizQuestionRow {
  id: string
  family_id: string
  quiz_id: string
  entry_id: string
  position: number
  stem: string
  options: unknown
  answer_key: WordQuizQuestion['answerKey']
}

interface WordAnswerRecordRow {
  id: string
  family_id: string
  quiz_id: string
  question_id: string
  kid_id: string
  selected_key: WordQuizQuestion['answerKey']
  is_correct: boolean
  client_event_id: string | null
  answered_at: Date
  direction: WordQuiz['direction']
  word: string
  meaning: string
}

interface WordWrongItemRow {
  id: string
  family_id: string
  kid_id: string
  entry_id: string
  wordbook_id: string
  word: string
  phonetic: string
  meaning: string
  wrong_count: number
  correct_streak: number
  status: WordWrongItem['status']
  last_wrong_at: Date
  mastered_at: Date | null
}

export class PostgresWordbookRepository implements WordbookRepository {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 4 })
  }

  async saveWordbook(item: Wordbook): Promise<void> {
    await this.pool.query(
      `insert into wordbook (
         id, family_id, name, file_name, source_type, status, draft,
         entry_count, created_by, created_at, confirmed_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       on conflict (id) do update
         set status = excluded.status,
             draft = excluded.draft,
             entry_count = excluded.entry_count,
             confirmed_at = excluded.confirmed_at`,
      [
        item.id,
        item.familyId,
        item.name,
        item.fileName,
        item.sourceType,
        item.status,
        JSON.stringify(item.entries),
        item.entryCount,
        item.createdBy,
        item.createdAt,
        item.confirmedAt ?? null,
      ],
    )
  }

  async getWordbook(
    familyId: string,
    id: string,
  ): Promise<Wordbook | undefined> {
    const result = await this.pool.query<WordbookRow>(
      `select id, family_id, name, file_name, source_type, status, draft,
              entry_count, created_by, created_at, confirmed_at
         from wordbook
        where family_id = $1 and id = $2`,
      [familyId, id],
    )
    const row = result.rows[0]
    return row ? toWordbook(row) : undefined
  }

  async listWordbooks(familyId: string): Promise<Wordbook[]> {
    const result = await this.pool.query<WordbookRow>(
      `select id, family_id, name, file_name, source_type, status, draft,
              entry_count, created_by, created_at, confirmed_at
         from wordbook
        where family_id = $1
        order by created_at desc`,
      [familyId],
    )
    return result.rows.map(toWordbook)
  }

  async deleteWordbook(familyId: string, id: string): Promise<void> {
    await this.pool.query(
      'delete from wordbook where family_id = $1 and id = $2',
      [familyId, id],
    )
  }

  async replaceEntries(
    familyId: string,
    wordbookId: string,
    entries: StoredWordEntry[],
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query(
        'delete from word_entry where family_id = $1 and wordbook_id = $2',
        [familyId, wordbookId],
      )
      for (const entry of entries) {
        await client.query(
          `insert into word_entry (
             id, family_id, wordbook_id, word, normalized_word, phonetic,
             part_of_speech, meaning, position
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            entry.id,
            familyId,
            wordbookId,
            entry.word,
            entry.normalizedWord,
            entry.phonetic,
            entry.partOfSpeech,
            entry.meaning,
            entry.position,
          ],
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

  async listEntries(
    familyId: string,
    wordbookId: string,
  ): Promise<StoredWordEntry[]> {
    const result = await this.pool.query<WordEntryRow>(
      `select id, family_id, wordbook_id, word, normalized_word, phonetic,
              part_of_speech, meaning, position
         from word_entry
        where family_id = $1 and wordbook_id = $2
        order by position`,
      [familyId, wordbookId],
    )
    return result.rows.map(toEntry)
  }

  async saveQuiz(
    quiz: WordQuiz,
    questions: WordQuizQuestion[],
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `insert into word_quiz (
           id, family_id, kid_id, wordbook_id, direction, delivery_mode,
           question_count, status, assigned_local_date, created_by,
           created_at, completed_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12)`,
        [
          quiz.id,
          quiz.familyId,
          quiz.kidId,
          quiz.wordbookId,
          quiz.direction,
          quiz.deliveryMode,
          quiz.questionCount,
          quiz.status,
          quiz.assignedLocalDate,
          quiz.createdBy,
          quiz.createdAt,
          quiz.completedAt ?? null,
        ],
      )
      for (const question of questions) {
        await client.query(
          `insert into word_quiz_question (
             id, family_id, quiz_id, entry_id, position, stem, options,
             answer_key
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            question.id,
            quiz.familyId,
            quiz.id,
            question.entryId,
            question.position,
            question.stem,
            JSON.stringify(question.options),
            question.answerKey,
          ],
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

  async getQuiz(
    familyId: string,
    quizId: string,
  ): Promise<WordQuiz | undefined> {
    const result = await this.pool.query<WordQuizRow>(
      `${wordQuizSelect} where q.family_id = $1 and q.id = $2`,
      [familyId, quizId],
    )
    const row = result.rows[0]
    return row ? toQuiz(row) : undefined
  }

  async listQuizzes(
    familyId: string,
    kidId: string,
    limit: number,
  ): Promise<WordQuiz[]> {
    const result = await this.pool.query<WordQuizRow>(
      `${wordQuizSelect}
        where q.family_id = $1 and q.kid_id = $2
        order by q.created_at desc
        limit $3`,
      [familyId, kidId, limit],
    )
    return result.rows.map(toQuiz)
  }

  async listQuizQuestions(
    familyId: string,
    quizId: string,
  ): Promise<WordQuizQuestion[]> {
    const result = await this.pool.query<WordQuizQuestionRow>(
      `select id, family_id, quiz_id, entry_id, position, stem, options,
              answer_key
         from word_quiz_question
        where family_id = $1 and quiz_id = $2
        order by position`,
      [familyId, quizId],
    )
    return result.rows.map(toQuestion)
  }

  async saveAnswers(
    familyId: string,
    answers: StoredWordAnswer[],
  ): Promise<StoredWordAnswer[]> {
    const inserted: StoredWordAnswer[] = []
    for (const answer of answers) {
      const result = await this.pool.query(
        `insert into word_quiz_answer (
           id, family_id, quiz_id, question_id, kid_id, selected_key,
           is_correct, client_event_id, answered_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict do nothing
         returning question_id`,
        [
          answer.id,
          familyId,
          answer.quizId,
          answer.questionId,
          answer.kidId,
          answer.selectedKey,
          answer.isCorrect,
          answer.clientEventId ?? null,
          answer.answeredAt,
        ],
      )
      if (result.rowCount) inserted.push(answer)
    }
    return inserted
  }

  async countAnswers(familyId: string, quizId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `select count(*)::text as count
         from word_quiz_answer
        where family_id = $1 and quiz_id = $2`,
      [familyId, quizId],
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async completeQuiz(
    familyId: string,
    quizId: string,
    at: string,
  ): Promise<void> {
    await this.pool.query(
      `update word_quiz
          set status = 'completed', completed_at = coalesce(completed_at, $3)
        where family_id = $1 and id = $2`,
      [familyId, quizId, at],
    )
  }

  async listAnswerRecords(
    familyId: string,
    kidId: string,
    limit: number,
  ): Promise<WordAnswerRecord[]> {
    const result = await this.pool.query<WordAnswerRecordRow>(
      `select a.id, a.family_id, a.quiz_id, a.question_id, a.kid_id,
              a.selected_key, a.is_correct, a.client_event_id, a.answered_at,
              q.direction, e.word, e.meaning
         from word_quiz_answer a
         join word_quiz q
           on q.family_id = a.family_id and q.id = a.quiz_id
         join word_quiz_question qq
           on qq.family_id = a.family_id and qq.id = a.question_id
         join word_entry e
           on e.family_id = qq.family_id and e.id = qq.entry_id
        where a.family_id = $1 and a.kid_id = $2
        order by a.answered_at desc
        limit $3`,
      [familyId, kidId, limit],
    )
    return result.rows.map((row) => ({
      id: row.id,
      familyId: row.family_id,
      quizId: row.quiz_id,
      questionId: row.question_id,
      kidId: row.kid_id,
      selectedKey: row.selected_key,
      isCorrect: row.is_correct,
      ...(row.client_event_id ? { clientEventId: row.client_event_id } : {}),
      answeredAt: row.answered_at.toISOString(),
      direction: row.direction,
      word: row.word,
      meaning: row.meaning,
    }))
  }

  async recordWrong(
    familyId: string,
    kidId: string,
    entryId: string,
    wordbookId: string,
    at: string,
  ): Promise<void> {
    const entry = await this.pool.query<WordEntryRow>(
      `select id, family_id, wordbook_id, word, normalized_word, phonetic,
              part_of_speech, meaning, position
         from word_entry
        where family_id = $1 and id = $2`,
      [familyId, entryId],
    )
    const row = entry.rows[0]
    if (!row) return
    await this.pool.query(
      `insert into word_wrong_item (
         id, family_id, kid_id, entry_id, wordbook_id, wrong_count,
         correct_streak, status, last_wrong_at
       ) values (gen_random_uuid(), $1, $2, $3, $4, 1, 0, 'active', $5)
       on conflict (family_id, kid_id, entry_id) do update
         set wrong_count = word_wrong_item.wrong_count + 1,
             correct_streak = 0,
             status = 'active',
             mastered_at = null,
             last_wrong_at = excluded.last_wrong_at`,
      [familyId, kidId, entryId, wordbookId, at],
    )
  }

  async recordCorrect(
    familyId: string,
    kidId: string,
    entryId: string,
    at: string,
  ): Promise<void> {
    await this.pool.query(
      `update word_wrong_item
          set correct_streak = correct_streak + 1,
              status = case
                when correct_streak + 1 >= 2 then 'mastered'
                else 'active'
              end,
              mastered_at = case
                when correct_streak + 1 >= 2 then $4::timestamptz
                else null
              end
        where family_id = $1 and kid_id = $2 and entry_id = $3
          and status = 'active'`,
      [familyId, kidId, entryId, at],
    )
  }

  async listWrongItems(
    familyId: string,
    kidId: string,
    status?: WordWrongItem['status'],
  ): Promise<WordWrongItem[]> {
    const result = await this.pool.query<WordWrongItemRow>(
      `select w.id, w.family_id, w.kid_id, w.entry_id, w.wordbook_id,
              e.word, e.phonetic, e.meaning, w.wrong_count,
              w.correct_streak, w.status, w.last_wrong_at, w.mastered_at
         from word_wrong_item w
         join word_entry e
           on e.family_id = w.family_id and e.id = w.entry_id
        where w.family_id = $1 and w.kid_id = $2
          and ($3::text is null or w.status = $3::text)
        order by w.last_wrong_at desc`,
      [familyId, kidId, status ?? null],
    )
    return result.rows.map((row) => ({
      id: row.id,
      familyId: row.family_id,
      kidId: row.kid_id,
      entryId: row.entry_id,
      wordbookId: row.wordbook_id,
      word: row.word,
      phonetic: row.phonetic,
      meaning: row.meaning,
      wrongCount: row.wrong_count,
      correctStreak: row.correct_streak,
      status: row.status,
      lastWrongAt: row.last_wrong_at.toISOString(),
      ...(row.mastered_at ? { masteredAt: row.mastered_at.toISOString() } : {}),
    }))
  }

  async updateWrongStatus(
    familyId: string,
    kidId: string,
    itemId: string,
    status: WordWrongItem['status'],
    at: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `update word_wrong_item
          set status = $4,
              mastered_at = case when $4 = 'mastered' then $5::timestamptz else null end
        where family_id = $1 and kid_id = $2 and id = $3`,
      [familyId, kidId, itemId, status, at],
    )
    if (!result.rowCount) throw new Error('WORD_WRONG_ITEM_NOT_FOUND')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

const wordQuizSelect = `select q.id, q.family_id, q.kid_id, q.wordbook_id,
       q.direction, q.delivery_mode, q.question_count, q.status,
       q.assigned_local_date, q.created_by, q.created_at, q.completed_at
  from word_quiz q`

function toWordbook(row: WordbookRow): Wordbook {
  const entries = Array.isArray(row.draft)
    ? row.draft
        .map((entry) => wordDraftEntrySchema.safeParse(entry))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data)
    : []
    return {
      id: row.id,
      familyId: row.family_id,
      name: row.name,
      fileName: row.file_name,
      sourceType: row.source_type,
      status: row.status,
      entries,
      entryCount: row.entry_count,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      ...(row.confirmed_at
        ? { confirmedAt: row.confirmed_at.toISOString() }
        : {}),
    }
}

function toEntry(row: WordEntryRow): StoredWordEntry {
  return {
    id: row.id,
    familyId: row.family_id,
    wordbookId: row.wordbook_id,
    word: row.word,
    normalizedWord: row.normalized_word,
    phonetic: row.phonetic,
    partOfSpeech: row.part_of_speech,
    meaning: row.meaning,
    position: row.position,
  }
}

function toQuiz(row: WordQuizRow): WordQuiz {
  return {
    id: row.id,
    familyId: row.family_id,
    kidId: row.kid_id,
    wordbookId: row.wordbook_id,
    direction: row.direction,
    deliveryMode: row.delivery_mode,
    questionCount: row.question_count,
    status: row.status,
    assignedLocalDate:
      row.assigned_local_date instanceof Date
        ? row.assigned_local_date.toISOString().slice(0, 10)
        : row.assigned_local_date,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    ...(row.completed_at
      ? { completedAt: row.completed_at.toISOString() }
      : {}),
  }
}

function toQuestion(row: WordQuizQuestionRow): WordQuizQuestion {
  return {
    id: row.id,
    familyId: row.family_id,
    quizId: row.quiz_id,
    entryId: row.entry_id,
    position: row.position,
    stem: row.stem,
    options: Array.isArray(row.options)
      ? (row.options as WordQuizQuestion['options'])
      : [],
    answerKey: row.answer_key,
  }
}
