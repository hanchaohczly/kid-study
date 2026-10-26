import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'

export type WordbookSourceType = 'pdf' | 'docx' | 'text'
export type WordQuizDirection = 'en_to_zh' | 'zh_to_en'
export type WordQuizDeliveryMode = 'passport' | 'web'
export type WordQuizStatus = 'assigned' | 'completed'
export type WordWrongItemStatus = 'active' | 'mastered'
export type OptionKey = 'A' | 'B' | 'C' | 'D'

const optionKeys: OptionKey[] = ['A', 'B', 'C', 'D']
const cjkPattern = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/
const wordPattern = /^[A-Za-z][A-Za-z'\- .]{0,79}$/
const posTokens =
  'n|v|vt|vi|adj|adv|prep|pron|conj|num|art|int|interj|aux|modal|abbr|phr'
const posAtStart = new RegExp(`^((?:${posTokens})\\.)\\s+(.+)$`, 'i')
const posAtEnd = new RegExp(`^(.+?)\\s+((?:${posTokens})\\.)$`, 'i')

export const wordDraftEntrySchema = z.object({
  word: z.string().trim().min(1).max(80).regex(wordPattern),
  phonetic: z.string().trim().max(60).default(''),
  partOfSpeech: z.string().trim().max(20).default(''),
  meaning: z.string().trim().min(1).max(300),
})

export type WordDraftEntry = z.infer<typeof wordDraftEntrySchema>

export const wordbookDraftSchema = z.object({
  entries: z.array(wordDraftEntrySchema).min(1).max(2_000),
})

export interface Wordbook {
  id: string
  familyId: string
  name: string
  fileName: string
  sourceType: WordbookSourceType
  status: 'ready_for_review' | 'confirmed'
  entries: WordDraftEntry[]
  entryCount: number
  createdBy: string
  createdAt: string
  confirmedAt?: string
}

export interface StoredWordEntry {
  id: string
  familyId: string
  wordbookId: string
  word: string
  normalizedWord: string
  phonetic: string
  partOfSpeech: string
  meaning: string
  position: number
}

export interface WordQuiz {
  id: string
  familyId: string
  kidId: string
  wordbookId: string
  direction: WordQuizDirection
  deliveryMode: WordQuizDeliveryMode
  questionCount: number
  status: WordQuizStatus
  assignedLocalDate: string
  createdBy: string
  createdAt: string
  completedAt?: string
}

export interface WordQuizOption {
  key: OptionKey
  text: string
}

export interface WordQuizQuestion {
  id: string
  familyId: string
  quizId: string
  entryId: string
  position: number
  stem: string
  options: WordQuizOption[]
  answerKey: OptionKey
}

export interface StoredWordAnswer {
  id: string
  familyId: string
  quizId: string
  questionId: string
  kidId: string
  selectedKey: OptionKey
  isCorrect: boolean
  clientEventId?: string
  answeredAt: string
}

export interface WordAnswerRecord extends StoredWordAnswer {
  word: string
  meaning: string
  direction: WordQuizDirection
}

export interface WordWrongItem {
  id: string
  familyId: string
  kidId: string
  entryId: string
  wordbookId: string
  word: string
  phonetic: string
  meaning: string
  wrongCount: number
  correctStreak: number
  status: WordWrongItemStatus
  lastWrongAt: string
  masteredAt?: string
}

export interface WordbookRepository {
  commitAnswers(
    quiz: WordQuiz,
    questions: WordQuizQuestion[],
    answers: StoredWordAnswer[],
    at: string,
  ): Promise<{ inserted: StoredWordAnswer[]; answers: StoredWordAnswer[] }>
  listQuizAnswers(familyId: string, quizId: string): Promise<StoredWordAnswer[]>
  saveWordbook(item: Wordbook): Promise<void>
  getWordbook(familyId: string, id: string): Promise<Wordbook | undefined>
  listWordbooks(familyId: string): Promise<Wordbook[]>
  deleteWordbook(familyId: string, id: string): Promise<void>

  replaceEntries(
    familyId: string,
    wordbookId: string,
    entries: StoredWordEntry[],
  ): Promise<void>
  listEntries(
    familyId: string,
    wordbookId: string,
  ): Promise<StoredWordEntry[]>

  saveQuiz(quiz: WordQuiz, questions: WordQuizQuestion[]): Promise<void>
  getQuiz(familyId: string, quizId: string): Promise<WordQuiz | undefined>
  listQuizzes(
    familyId: string,
    kidId: string,
    limit: number,
  ): Promise<WordQuiz[]>
  listQuizQuestions(
    familyId: string,
    quizId: string,
  ): Promise<WordQuizQuestion[]>
  saveAnswers(
    familyId: string,
    answers: StoredWordAnswer[],
  ): Promise<StoredWordAnswer[]>
  countAnswers(familyId: string, quizId: string): Promise<number>
  completeQuiz(familyId: string, quizId: string, at: string): Promise<void>
  listAnswerRecords(
    familyId: string,
    kidId: string,
    limit: number,
  ): Promise<WordAnswerRecord[]>

  recordWrong(
    familyId: string,
    kidId: string,
    entryId: string,
    wordbookId: string,
    at: string,
  ): Promise<void>
  recordCorrect(
    familyId: string,
    kidId: string,
    entryId: string,
    at: string,
  ): Promise<void>
  listWrongItems(
    familyId: string,
    kidId: string,
    status?: WordWrongItemStatus,
  ): Promise<WordWrongItem[]>
  updateWrongStatus(
    familyId: string,
    kidId: string,
    itemId: string,
    status: WordWrongItemStatus,
    at: string,
  ): Promise<void>
  close(): Promise<void>
}

export interface ParsedWordEntry {
  word: string
  normalizedWord: string
  phonetic: string
  partOfSpeech: string
  meaning: string
}

/**
 * 从纯文本中提取词条。支持 "apple /ˈæpl/ n. 苹果"、"1. apple 苹果"、
 * "apple\t苹果" 等常见词本排版，遇到无法识别的行直接跳过。
 */
export function parseWordbookText(text: string): WordDraftEntry[] {
  const entries: WordDraftEntry[] = []
  const seen = new Set<string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const parsed = parseWordLine(rawLine)
    if (!parsed) continue
    const key = `${parsed.normalizedWord}|${parsed.partOfSpeech}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      word: parsed.word,
      phonetic: parsed.phonetic,
      partOfSpeech: parsed.partOfSpeech,
      meaning: parsed.meaning,
    })
  }
  return entries
}

function parseWordLine(rawLine: string): ParsedWordEntry | undefined {
  let line = rawLine
    .replace(/\ufeff/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()
  if (!line) return undefined

  line = line
    .replace(/^[•·●▪■□◆◇◆→]\s*/, '')
    .replace(/^-\s+/, '')
    .replace(/^\d{1,4}\s*[.．、)）]\s*/, '')
    .replace(/^[(（]\d{1,4}[)）]\s*/, '')
    .trim()

  if (line.includes('\t')) {
    const cells = line
      .split('\t')
      .map((cell) => cell.trim())
      .filter(Boolean)
    const [first, ...rest] = cells
    if (first && rest.length) {
      return buildEntry(first, rest.join(' '))
    }
  }

  const cjkIndex = line.search(cjkPattern)
  if (cjkIndex < 1) return undefined
  return buildEntry(line.slice(0, cjkIndex), line.slice(cjkIndex))
}

function buildEntry(
  rawHead: string,
  rawMeaning: string,
): ParsedWordEntry | undefined {
  let head = rawHead.replace(/\s+/g, ' ').trim()
  head = head.replace(/[\-–—:：|,，;；]+$/u, '').trim()

  let phonetic = ''
  const phoneticMatch = head.match(/[/\[]([^/\]]{1,60})[/\]]/)
  const phoneticValue = phoneticMatch?.[1]
  if (phoneticMatch && phoneticValue) {
    phonetic = phoneticValue.trim()
    head = head.replace(phoneticMatch[0], ' ').replace(/\s+/g, ' ').trim()
  }

  let partOfSpeech = ''
  const startMatch = head.match(posAtStart)
  const endMatch = head.match(posAtEnd)
  const startPos = startMatch?.[1]
  const startWord = startMatch?.[2]
  const endWord = endMatch?.[1]
  const endPos = endMatch?.[2]
  if (startPos && startWord) {
    partOfSpeech = startPos
    head = startWord.trim()
  } else if (endWord && endPos) {
    partOfSpeech = endPos
    head = endWord.trim()
  }

  const word = head.replace(/[\-–—:：|,，;；]+$/u, '').trim()
  if (!word || !wordPattern.test(word)) return undefined
  if (!/[A-Za-z]/.test(word)) return undefined

  const meaning = rawMeaning
    .replace(/^[\s\-–—:：|,，;；.。]+/u, '')
    .trim()
    .slice(0, 300)
  if (!meaning) return undefined
  if (!/[A-Za-z\u3400-\u9fff]/.test(meaning)) return undefined
  if (/^\d+$/.test(meaning)) return undefined

  return {
    word,
    normalizedWord: normalizeWord(word),
    phonetic,
    partOfSpeech,
    meaning,
  }
}

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export class WordbookService {
  constructor(private readonly repository: WordbookRepository) {}

  async import(input: {
    familyId: string
    createdBy: string
    fileName: string
    sourceType: WordbookSourceType
    text: string
  }): Promise<Wordbook> {
    const entries = parseWordbookText(input.text)
    if (!entries.length) throw new Error('WORDBOOK_NO_ENTRIES')
    const now = new Date().toISOString()
    const wordbook: Wordbook = {
      id: randomUUID(),
      familyId: input.familyId,
      name: deriveName(input.fileName),
      fileName: input.fileName,
      sourceType: input.sourceType,
      status: 'ready_for_review',
      entries,
      entryCount: entries.length,
      createdBy: input.createdBy,
      createdAt: now,
    }
    await this.repository.saveWordbook(wordbook)
    return wordbook
  }

  get(familyId: string, id: string): Promise<Wordbook | undefined> {
    return this.repository.getWordbook(familyId, id)
  }

  list(familyId: string): Promise<Wordbook[]> {
    return this.repository.listWordbooks(familyId)
  }

  async updateDraft(input: {
    familyId: string
    id: string
    entries: WordDraftEntry[]
  }): Promise<Wordbook> {
    const wordbook = await this.requireWordbook(input.familyId, input.id)
    if (wordbook.status !== 'ready_for_review') {
      throw new Error('WORDBOOK_ALREADY_CONFIRMED')
    }
    const entries = dedupeEntries(input.entries)
    if (!entries.length) throw new Error('WORDBOOK_NO_ENTRIES')
    const updated: Wordbook = {
      ...wordbook,
      entries,
      entryCount: entries.length,
    }
    await this.repository.saveWordbook(updated)
    return updated
  }

  async confirm(input: {
    familyId: string
    id: string
    createdBy: string
  }): Promise<Wordbook> {
    const wordbook = await this.requireWordbook(input.familyId, input.id)
    if (wordbook.status === 'confirmed') return wordbook
    const entries = dedupeEntries(wordbook.entries)
    if (!entries.length) throw new Error('WORDBOOK_NO_ENTRIES')

    const stored: StoredWordEntry[] = entries.map((entry, position) => ({
      id: randomUUID(),
      familyId: input.familyId,
      wordbookId: wordbook.id,
      word: entry.word,
      normalizedWord: normalizeWord(entry.word),
      phonetic: entry.phonetic,
      partOfSpeech: entry.partOfSpeech,
      meaning: entry.meaning,
      position,
    }))
    await this.repository.replaceEntries(input.familyId, wordbook.id, stored)
    const confirmed: Wordbook = {
      ...wordbook,
      entries,
      entryCount: entries.length,
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
    }
    await this.repository.saveWordbook(confirmed)
    return confirmed
  }

  async remove(familyId: string, id: string): Promise<void> {
    await this.repository.deleteWordbook(familyId, id)
  }

  async createQuiz(input: {
    familyId: string
    kidId: string
    createdBy: string
    wordbookId: string
    direction: WordQuizDirection
    count: number
    deliveryMode: WordQuizDeliveryMode
    now?: Date
  }): Promise<{ quiz: WordQuiz; questions: WordQuizQuestion[] }> {
    const wordbook = await this.requireWordbook(input.familyId, input.wordbookId)
    if (wordbook.status !== 'confirmed') {
      throw new Error('WORDBOOK_NOT_CONFIRMED')
    }
    const entries = await this.repository.listEntries(
      input.familyId,
      input.wordbookId,
    )
    if (entries.length < 4) throw new Error('WORDBOOK_TOO_SMALL')

    const quiz: WordQuiz = {
      id: randomUUID(),
      familyId: input.familyId,
      kidId: input.kidId,
      wordbookId: input.wordbookId,
      direction: input.direction,
      deliveryMode: input.deliveryMode,
      questionCount: Math.min(input.count, entries.length),
      status: 'assigned',
      assignedLocalDate: localDate(input.now ?? new Date()),
      createdBy: input.createdBy,
      createdAt: (input.now ?? new Date()).toISOString(),
    }
    const questions = buildQuestions(quiz, entries)
    quiz.questionCount = questions.length
    await this.repository.saveQuiz(quiz, questions)
    return { quiz, questions }
  }

  async getQuiz(
    familyId: string,
    quizId: string,
    kidId?: string,
  ): Promise<WordQuiz> {
    const quiz = await this.repository.getQuiz(familyId, quizId)
    if (!quiz) throw new Error('WORD_QUIZ_NOT_FOUND')
    if (kidId && quiz.kidId !== kidId) throw new Error('WORD_QUIZ_NOT_FOUND')
    return quiz
  }

  listQuizzes(
    familyId: string,
    kidId: string,
    limit = 10,
  ): Promise<WordQuiz[]> {
    return this.repository.listQuizzes(familyId, kidId, limit)
  }

  async submitAnswers(input: {
    familyId: string
    kidId: string
    quizId: string
    answers: Array<{
      questionId: string
      selectedKey: OptionKey
      clientEventId?: string | undefined
    }>
    now?: Date
  }): Promise<{
    accepted: string[]
    duplicated: string[]
    completed: boolean
    answeredCount: number
    results: Array<{ questionId: string; selectedKey: OptionKey; isCorrect: boolean }>
  }> {
    const quiz = await this.getQuiz(input.familyId, input.quizId, input.kidId)
    const questions = await this.repository.listQuizQuestions(
      input.familyId,
      quiz.id,
    )
    const byId = new Map(questions.map((question) => [question.id, question]))
    const now = (input.now ?? new Date()).toISOString()

    const results: StoredWordAnswer[] = []
    for (const answer of input.answers) {
      const question = byId.get(answer.questionId)
      if (!question) throw new Error('WORD_QUIZ_QUESTION_NOT_FOUND')
      results.push({
        id: randomUUID(),
        familyId: input.familyId,
        quizId: quiz.id,
        questionId: question.id,
        kidId: input.kidId,
        selectedKey: answer.selectedKey,
        isCorrect: question.answerKey === answer.selectedKey,
        ...(answer.clientEventId
          ? { clientEventId: answer.clientEventId }
          : {}),
        answeredAt: now,
      })
    }

    const { inserted, answers: persisted } = await this.repository.commitAnswers(
      quiz, questions, results, now,
    )
    const insertedIds = new Set(inserted.map((item) => item.questionId))
    const duplicated = results
      .filter((item) => {
        if (!insertedIds.has(item.questionId)) return true
        insertedIds.delete(item.questionId)
        return false
      })
      .map((item) => item.questionId)

    return {
      accepted: inserted.map((item) => item.questionId),
      duplicated,
      completed: persisted.length >= questions.length,
      answeredCount: persisted.length,
      results: persisted.map((item) => ({
        questionId: item.questionId,
        selectedKey: item.selectedKey,
        isCorrect: item.isCorrect,
      })),
    }
  }

  async quizProgress(familyId: string, quizId: string) {
    const answers = await this.repository.listQuizAnswers(familyId, quizId)
    return answers.map(({ questionId, selectedKey, isCorrect }) => ({
      questionId, selectedKey, isCorrect,
    }))
  }

  listQuizQuestions(
    familyId: string,
    quizId: string,
  ): Promise<WordQuizQuestion[]> {
    return this.repository.listQuizQuestions(familyId, quizId)
  }

  async stats(
    familyId: string,
    kidId: string,
  ): Promise<{
    totalAnswers: number
    correctAnswers: number
    accuracy: number
    byDirection: Record<
      WordQuizDirection,
      { totalAnswers: number; correctAnswers: number; accuracy: number }
    >
    wrongItems: { active: number; mastered: number }
  }> {
    const records = await this.repository.listAnswerRecords(
      familyId,
      kidId,
      5_000,
    )
    const empty = { totalAnswers: 0, correctAnswers: 0, accuracy: 0 }
    const byDirection: Record<
      WordQuizDirection,
      { totalAnswers: number; correctAnswers: number; accuracy: number }
    > = {
      en_to_zh: { ...empty },
      zh_to_en: { ...empty },
    }
    let correct = 0
    for (const record of records) {
      const bucket = byDirection[record.direction]
      bucket.totalAnswers += 1
      if (record.isCorrect) {
        bucket.correctAnswers += 1
        correct += 1
      }
    }
    for (const bucket of Object.values(byDirection)) {
      bucket.accuracy = bucket.totalAnswers
        ? round(bucket.correctAnswers / bucket.totalAnswers)
        : 0
    }
    const wrongItems = await this.repository.listWrongItems(familyId, kidId)
    return {
      totalAnswers: records.length,
      correctAnswers: correct,
      accuracy: records.length ? round(correct / records.length) : 0,
      byDirection,
      wrongItems: {
        active: wrongItems.filter((item) => item.status === 'active').length,
        mastered: wrongItems.filter((item) => item.status === 'mastered').length,
      },
    }
  }

  listWrongItems(
    familyId: string,
    kidId: string,
    status?: WordWrongItemStatus,
  ): Promise<WordWrongItem[]> {
    return this.repository.listWrongItems(familyId, kidId, status)
  }

  async updateWrongStatus(input: {
    familyId: string
    kidId: string
    id: string
    status: WordWrongItemStatus
  }): Promise<void> {
    await this.repository.updateWrongStatus(
      input.familyId,
      input.kidId,
      input.id,
      input.status,
      new Date().toISOString(),
    )
  }

  close(): Promise<void> {
    return this.repository.close()
  }

  private async requireWordbook(
    familyId: string,
    id: string,
  ): Promise<Wordbook> {
    const wordbook = await this.repository.getWordbook(familyId, id)
    if (!wordbook) throw new Error('WORDBOOK_NOT_FOUND')
    return wordbook
  }
}

function buildQuestions(
  quiz: WordQuiz,
  entries: StoredWordEntry[],
): WordQuizQuestion[] {
  const rng = createRng(seedFrom(quiz.id))
  const correctText = (entry: StoredWordEntry) =>
    truncate(quiz.direction === 'en_to_zh' ? entry.meaning : entry.word)
  const stemText = (entry: StoredWordEntry) =>
    truncate(quiz.direction === 'en_to_zh' ? entry.word : entry.meaning, 160)
  const pool = dedupeBy(entries, (entry) => normalizeText(correctText(entry)))
  if (pool.length < 4) throw new Error('WORDBOOK_TOO_SMALL')

  // 同一展示题干对应多个答案时不能生成单选题。
  const meaningsByStem = new Map<string, Set<string>>()
  for (const entry of entries) {
    const stem = normalizeText(stemText(entry))
    const values = meaningsByStem.get(stem) ?? new Set<string>()
    values.add(normalizeText(correctText(entry)))
    meaningsByStem.set(stem, values)
  }
  const eligible = dedupeBy(entries.filter(
    (entry) => meaningsByStem.get(normalizeText(stemText(entry)))?.size === 1,
  ), (entry) => normalizeText(stemText(entry)))
  if (!eligible.length) throw new Error('WORDBOOK_TOO_SMALL')
  const targets = shuffle(eligible, rng).slice(
    0,
    Math.min(quiz.questionCount, eligible.length),
  )
  return targets.map((target, position) => {
    const answerText = correctText(target)
    const distractors = shuffle(
      pool.filter(
        (entry) =>
          normalizeText(correctText(entry)) !== normalizeText(answerText),
      ),
      rng,
    )
      .slice(0, 3)
      .map((entry) => truncate(correctText(entry)))
    if (distractors.length < 3) throw new Error('WORDBOOK_TOO_SMALL')

    const texts = shuffle([truncate(answerText), ...distractors], rng)
    const options = texts.map((text, index) => ({
      key: optionKeys[index] as OptionKey,
      text,
    }))
    const answerKey = options.find(
      (option) => option.text === truncate(answerText),
    )?.key
    if (!answerKey) throw new Error('WORDBOOK_TOO_SMALL')

    return {
      id: randomUUID(),
      familyId: quiz.familyId,
      quizId: quiz.id,
      entryId: target.id,
      position,
      stem: stemText(target),
      options,
      answerKey,
    }
  })
}

function dedupeEntries(entries: WordDraftEntry[]): WordDraftEntry[] {
  const seen = new Set<string>()
  const result: WordDraftEntry[] = []
  for (const entry of entries) {
    const parsed = wordDraftEntrySchema.safeParse(entry)
    if (!parsed.success) continue
    const key = `${normalizeWord(parsed.data.word)}|${parsed.data.partOfSpeech}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(parsed.data)
  }
  return result
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const value = key(item)
    if (seen.has(value)) continue
    seen.add(value)
    result.push(item)
  }
  return result
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.,，。;；:：!！?？'"‘’“”()（）[\]【】]/g, '')
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function deriveName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  const name = base.trim()
  return (name || '单词本').slice(0, 120)
}

function localDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function seedFrom(value: string): number {
  const hash = createHash('sha256').update(value).digest()
  return hash.readUInt32BE(0)
}

function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const current = result[index] as T
    result[index] = result[swap] as T
    result[swap] = current
  }
  return result
}
