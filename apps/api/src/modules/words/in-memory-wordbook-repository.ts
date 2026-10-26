import { randomUUID } from 'node:crypto'
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

export class InMemoryWordbookRepository implements WordbookRepository {
  private readonly wordbooks = new Map<string, Wordbook>()
  private readonly entries = new Map<string, StoredWordEntry[]>()
  private readonly quizzes = new Map<string, WordQuiz>()
  private readonly questions = new Map<string, WordQuizQuestion[]>()
  private readonly answers = new Map<string, StoredWordAnswer[]>()
  private readonly wrongItems = new Map<string, WordWrongItem>()
  private commitQueue: Promise<void> = Promise.resolve()

  async listQuizAnswers(familyId: string, quizId: string): Promise<StoredWordAnswer[]> {
    return (this.answers.get(scoped(familyId, quizId)) ?? []).map((item) => ({ ...item }))
  }

  async commitAnswers(
    quiz: WordQuiz, questions: WordQuizQuestion[], answers: StoredWordAnswer[], at: string,
  ): Promise<{ inserted: StoredWordAnswer[]; answers: StoredWordAnswer[] }> {
    const previous = this.commitQueue
    let release!: () => void
    this.commitQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    const savedAnswers = new Map(this.answers)
    const savedWrong = new Map(this.wrongItems)
    const savedQuizzes = new Map(this.quizzes)
    try {
      const inserted = await this.saveAnswers(quiz.familyId, answers)
      for (const answer of inserted) {
        const question = questions.find((item) => item.id === answer.questionId)!
        if (answer.isCorrect) {
          await this.recordCorrect(quiz.familyId, quiz.kidId, question.entryId, at)
        } else {
          await this.recordWrong(quiz.familyId, quiz.kidId, question.entryId, quiz.wordbookId, at)
        }
      }
      const persisted = await this.listQuizAnswers(quiz.familyId, quiz.id)
      if (persisted.length >= questions.length) await this.completeQuiz(quiz.familyId, quiz.id, at)
      return { inserted, answers: persisted }
    } catch (error) {
      this.answers.clear()
      this.wrongItems.clear()
      this.quizzes.clear()
      for (const [key, value] of savedAnswers) this.answers.set(key, value)
      for (const [key, value] of savedWrong) this.wrongItems.set(key, value)
      for (const [key, value] of savedQuizzes) this.quizzes.set(key, value)
      throw error
    } finally {
      release()
    }
  }

  async saveWordbook(item: Wordbook): Promise<void> {
    this.wordbooks.set(scoped(item.familyId, item.id), { ...item })
  }

  async getWordbook(
    familyId: string,
    id: string,
  ): Promise<Wordbook | undefined> {
    return this.wordbooks.get(scoped(familyId, id))
  }

  async listWordbooks(familyId: string): Promise<Wordbook[]> {
    return [...this.wordbooks.values()]
      .filter((item) => item.familyId === familyId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async deleteWordbook(familyId: string, id: string): Promise<void> {
    this.wordbooks.delete(scoped(familyId, id))
    this.entries.delete(scoped(familyId, id))
    for (const quiz of [...this.quizzes.values()]) {
      if (quiz.familyId === familyId && quiz.wordbookId === id) {
        this.quizzes.delete(scoped(familyId, quiz.id))
        this.questions.delete(scoped(familyId, quiz.id))
      }
    }
  }

  async replaceEntries(
    familyId: string,
    wordbookId: string,
    entries: StoredWordEntry[],
  ): Promise<void> {
    this.entries.set(scoped(familyId, wordbookId), entries.map((item) => ({ ...item })))
  }

  async listEntries(
    familyId: string,
    wordbookId: string,
  ): Promise<StoredWordEntry[]> {
    return (this.entries.get(scoped(familyId, wordbookId)) ?? []).map((item) => ({
      ...item,
    }))
  }

  async saveQuiz(
    quiz: WordQuiz,
    questions: WordQuizQuestion[],
  ): Promise<void> {
    this.quizzes.set(scoped(quiz.familyId, quiz.id), { ...quiz })
    this.questions.set(
      scoped(quiz.familyId, quiz.id),
      questions.map((item) => ({ ...item })),
    )
  }

  async getQuiz(
    familyId: string,
    quizId: string,
  ): Promise<WordQuiz | undefined> {
    return this.quizzes.get(scoped(familyId, quizId))
  }

  async listQuizzes(
    familyId: string,
    kidId: string,
    limit: number,
  ): Promise<WordQuiz[]> {
    return [...this.quizzes.values()]
      .filter((item) => item.familyId === familyId && item.kidId === kidId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
  }

  async listQuizQuestions(
    familyId: string,
    quizId: string,
  ): Promise<WordQuizQuestion[]> {
    return (this.questions.get(scoped(familyId, quizId)) ?? []).map((item) => ({
      ...item,
    }))
  }

  async saveAnswers(
    familyId: string,
    answers: StoredWordAnswer[],
  ): Promise<StoredWordAnswer[]> {
    const key = scoped(familyId, answers[0]?.quizId ?? '')
    const existing = this.answers.get(key) ?? []
    const seen = new Set(existing.map((item) => item.questionId))
    const events = new Map(
      [...this.answers.values()].flat().filter((item) => item.familyId === familyId && item.clientEventId)
        .map((item) => [item.clientEventId!, item]),
    )
    const inserted: StoredWordAnswer[] = []
    for (const item of answers) {
      const event = item.clientEventId ? events.get(item.clientEventId) : undefined
      if (event && (event.quizId !== item.quizId || event.questionId !== item.questionId ||
        event.selectedKey !== item.selectedKey || event.kidId !== item.kidId)) {
        throw new Error('WORD_ANSWER_EVENT_CONFLICT')
      }
      if (seen.has(item.questionId)) continue
      seen.add(item.questionId)
      inserted.push(item)
      if (item.clientEventId) events.set(item.clientEventId, item)
    }
    this.answers.set(key, [...existing, ...inserted.map((item) => ({ ...item }))])
    return inserted
  }

  async countAnswers(familyId: string, quizId: string): Promise<number> {
    return (this.answers.get(scoped(familyId, quizId)) ?? []).length
  }

  async completeQuiz(
    familyId: string,
    quizId: string,
    at: string,
  ): Promise<void> {
    const key = scoped(familyId, quizId)
    const quiz = this.quizzes.get(key)
    if (quiz) this.quizzes.set(key, { ...quiz, status: 'completed', completedAt: quiz.completedAt ?? at })
  }

  async listAnswerRecords(
    familyId: string,
    kidId: string,
    limit: number,
  ): Promise<WordAnswerRecord[]> {
    const records: WordAnswerRecord[] = []
    for (const [key, items] of this.answers) {
      const quiz = this.quizzes.get(key)
      if (!quiz || quiz.familyId !== familyId || quiz.kidId !== kidId) continue
      const entryMap = new Map(
        (this.entries.get(scoped(familyId, quiz.wordbookId)) ?? []).map(
          (entry) => [entry.id, entry],
        ),
      )
      for (const item of items) {
        const question = (
          this.questions.get(scoped(familyId, quiz.id)) ?? []
        ).find((entry) => entry.id === item.questionId)
        const entry = question ? entryMap.get(question.entryId) : undefined
        records.push({
          ...item,
          direction: quiz.direction,
          word: entry?.word ?? '',
          meaning: entry?.meaning ?? '',
        })
      }
    }
    return records
      .sort((left, right) => right.answeredAt.localeCompare(left.answeredAt))
      .slice(0, limit)
  }

  async recordWrong(
    familyId: string,
    kidId: string,
    entryId: string,
    wordbookId: string,
    at: string,
  ): Promise<void> {
    const key = scoped(familyId, `${kidId}:${entryId}`)
    const entry = this.findEntry(familyId, entryId)
    const existing = this.wrongItems.get(key)
    this.wrongItems.set(key, {
      id: existing?.id ?? randomUUID(),
      familyId,
      kidId,
      entryId,
      wordbookId,
      word: entry?.word ?? existing?.word ?? '',
      phonetic: entry?.phonetic ?? existing?.phonetic ?? '',
      meaning: entry?.meaning ?? existing?.meaning ?? '',
      wrongCount: (existing?.wrongCount ?? 0) + 1,
      correctStreak: 0,
      status: 'active',
      lastWrongAt: at,
    })
  }

  async recordCorrect(
    familyId: string,
    kidId: string,
    entryId: string,
    at: string,
  ): Promise<void> {
    const key = scoped(familyId, `${kidId}:${entryId}`)
    const existing = this.wrongItems.get(key)
    if (!existing || existing.status !== 'active') return
    const streak = existing.correctStreak + 1
    this.wrongItems.set(key, {
      ...existing,
      correctStreak: streak,
      status: streak >= 2 ? 'mastered' : 'active',
      ...(streak >= 2 ? { masteredAt: at } : {}),
    })
  }

  async listWrongItems(
    familyId: string,
    kidId: string,
    status?: 'active' | 'mastered',
  ): Promise<WordWrongItem[]> {
    return [...this.wrongItems.values()]
      .filter(
        (item) =>
          item.familyId === familyId &&
          item.kidId === kidId &&
          (!status || item.status === status),
      )
      .sort((left, right) => right.lastWrongAt.localeCompare(left.lastWrongAt))
  }

  async updateWrongStatus(
    familyId: string,
    kidId: string,
    itemId: string,
    status: 'active' | 'mastered',
    at: string,
  ): Promise<void> {
    for (const [key, item] of this.wrongItems) {
      if (
        item.familyId === familyId &&
        item.kidId === kidId &&
        item.id === itemId
      ) {
        this.wrongItems.set(key, {
          ...item,
          status,
          ...(status === 'mastered' ? { masteredAt: at } : {}),
        })
        return
      }
    }
    throw new Error('WORD_WRONG_ITEM_NOT_FOUND')
  }

  async close(): Promise<void> {}

  private findEntry(
    familyId: string,
    entryId: string,
  ): StoredWordEntry | undefined {
    for (const [key, items] of this.entries) {
      if (!key.startsWith(`${familyId}:`)) continue
      const entry = items.find((item) => item.id === entryId)
      if (entry) return entry
    }
    return undefined
  }
}

function scoped(familyId: string, id: string): string {
  return `${familyId}:${id}`
}
