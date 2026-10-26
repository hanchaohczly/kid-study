import { describe, expect, it } from 'vitest'
import { InMemoryWordbookRepository } from './in-memory-wordbook-repository.js'
import {
  WordbookService,
  parseWordbookText,
} from './wordbook-service.js'

const familyId = '11111111-1111-4111-8111-111111111111'
const createdBy = '22222222-2222-4222-8222-222222222222'
const kidId = '33333333-3333-4333-8333-333333333333'

const sampleText = [
  'Unit 1 Food',
  '1. apple /ˈæpl/ n. 苹果',
  'banana n. 香蕉',
  'cat\t猫',
  'dog 狗，犬',
  'egg n. 鸡蛋',
  'fish n. 鱼',
].join('\n')

async function seedWordbook(repository = new InMemoryWordbookRepository()) {
  const service = new WordbookService(repository)
  const wordbook = await service.import({
    familyId,
    createdBy,
    fileName: '五年级上册单词表.pdf',
    sourceType: 'pdf',
    text: sampleText,
  })
  const confirmed = await service.confirm({
    familyId,
    id: wordbook.id,
    createdBy,
  })
  return { service, wordbook: confirmed }
}

describe('parseWordbookText', () => {
  it('parses common wordbook layouts and skips headings', () => {
    const entries = parseWordbookText(sampleText)

    expect(entries.map((entry) => entry.word)).toEqual([
      'apple',
      'banana',
      'cat',
      'dog',
      'egg',
      'fish',
    ])
    expect(entries[0]).toEqual({
      word: 'apple',
      phonetic: 'ˈæpl',
      partOfSpeech: 'n.',
      meaning: '苹果',
    })
    expect(entries[2]?.meaning).toBe('猫')
    expect(entries[3]?.meaning).toBe('狗，犬')
  })

  it('skips lines without a chinese meaning and keeps unique words', () => {
    const entries = parseWordbookText(
      [
        '--- PAGE 1 ---',
        'apple 苹果',
        'APPLE 苹果',
        '',
        'go to school',
      ].join('\n'),
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.word).toBe('apple')
  })
})

describe('WordbookService', () => {
  it('returns the persisted wrong answer when retrying with another option', async () => {
    const { service, wordbook } = await seedWordbook()
    const { quiz, questions } = await service.createQuiz({
      familyId, kidId, createdBy, wordbookId: wordbook.id,
      direction: 'en_to_zh', count: 2, deliveryMode: 'web',
    })
    const question = questions[0]!
    const wrongKey = question.answerKey === 'A' ? 'B' : 'A'
    const first = await service.submitAnswers({
      familyId, kidId, quizId: quiz.id,
      answers: [{ questionId: question.id, selectedKey: wrongKey }],
    })
    expect(first.completed).toBe(false)
    const replay = await service.submitAnswers({
      familyId, kidId, quizId: quiz.id,
      answers: [{ questionId: question.id, selectedKey: question.answerKey }],
    })
    expect(replay.results).toEqual(first.results)
    expect(replay.accepted).toEqual([])
    expect(replay.duplicated).toEqual([question.id])
    expect((await service.stats(familyId, kidId)).correctAnswers).toBe(0)
  })

  it('serializes concurrent retries and deduplicates repeated questions in one batch', async () => {
    const { service, wordbook } = await seedWordbook()
    const { quiz, questions } = await service.createQuiz({
      familyId, kidId, createdBy, wordbookId: wordbook.id,
      direction: 'en_to_zh', count: 1, deliveryMode: 'web',
    })
    const question = questions[0]!
    const answer = { questionId: question.id, selectedKey: question.answerKey, clientEventId: 'same-event' }
    const results = await Promise.all([1, 2, 3].map(() => service.submitAnswers({
      familyId, kidId, quizId: quiz.id, answers: [answer, answer],
    })))
    expect(results.reduce((sum, result) => sum + result.accepted.length, 0)).toBe(1)
    expect(results[0]?.duplicated).toEqual([question.id])
    expect((await service.stats(familyId, kidId)).totalAnswers).toBe(1)
  })

  it('rolls back a whole batch if a client event ID is reused for a different question', async () => {
    const { service, wordbook } = await seedWordbook()
    const { quiz, questions } = await service.createQuiz({
      familyId, kidId, createdBy, wordbookId: wordbook.id,
      direction: 'en_to_zh', count: 2, deliveryMode: 'web',
    })
    await expect(service.submitAnswers({
      familyId, kidId, quizId: quiz.id,
      answers: questions.map((question) => ({
        questionId: question.id, selectedKey: question.answerKey, clientEventId: 'collision',
      })),
    })).rejects.toThrow('WORD_ANSWER_EVENT_CONFLICT')
    expect((await service.stats(familyId, kidId)).totalAnswers).toBe(0)
    expect((await service.getQuiz(familyId, quiz.id)).status).toBe('assigned')
  })

  it('rolls back answer insertion if recording a wrong word fails, then safely retries', async () => {
    class FailingRepository extends InMemoryWordbookRepository {
      fail = true
      override async recordWrong(...args: Parameters<InMemoryWordbookRepository['recordWrong']>) {
        await super.recordWrong(...args)
        if (this.fail) throw new Error('INJECTED_FAILURE')
      }
    }
    const repository = new FailingRepository()
    const { service, wordbook } = await seedWordbook(repository)
    const { quiz, questions } = await service.createQuiz({
      familyId, kidId, createdBy, wordbookId: wordbook.id,
      direction: 'en_to_zh', count: 1, deliveryMode: 'web',
    })
    const question = questions[0]!
    const input = {
      familyId, kidId, quizId: quiz.id,
      answers: [{ questionId: question.id, selectedKey: question.answerKey === 'A' ? 'B' as const : 'A' as const }],
    }
    await expect(service.submitAnswers(input)).rejects.toThrow('INJECTED_FAILURE')
    expect((await service.stats(familyId, kidId)).totalAnswers).toBe(0)
    expect(await service.listWrongItems(familyId, kidId)).toHaveLength(0)
    repository.fail = false
    expect((await service.submitAnswers(input)).completed).toBe(true)
    expect((await service.listWrongItems(familyId, kidId))[0]?.wrongCount).toBe(1)
  })

  it('rejects four meanings whose displayed options collapse after truncation', async () => {
    const { service, wordbook } = await seedWordbook()
    const draft = await service.import({
      familyId, createdBy, fileName: 'long.txt', sourceType: 'text', text: sampleText,
    })
    await service.updateDraft({
      familyId, id: draft.id,
      entries: wordbook.entries.map((entry, index) => ({ ...entry, meaning: '共同前缀'.repeat(35) + index })),
    })
    await service.confirm({ familyId, id: draft.id, createdBy })
    await expect(service.createQuiz({
      familyId, kidId, createdBy, wordbookId: draft.id,
      direction: 'en_to_zh', count: 5, deliveryMode: 'passport',
    })).rejects.toThrow('WORDBOOK_TOO_SMALL')
  })

  it('excludes ambiguous stems and updates the actual question count', async () => {
    const { service } = await seedWordbook()
    const draft = await service.import({
      familyId, createdBy, fileName: 'synonyms.txt', sourceType: 'text',
      text: 'apple 苹果\nbanana 香蕉\ncat 猫\ndog 狗\nhound 狗',
    })
    await service.confirm({ familyId, id: draft.id, createdBy })
    const { quiz, questions } = await service.createQuiz({
      familyId, kidId, createdBy, wordbookId: draft.id,
      direction: 'zh_to_en', count: 5, deliveryMode: 'web',
    })
    expect(quiz.questionCount).toBe(3)
    expect(questions.every((question) => question.stem !== '狗')).toBe(true)
  })

  it('imports a draft then confirms entries', async () => {
    const { wordbook } = await seedWordbook()

    expect(wordbook.status).toBe('confirmed')
    expect(wordbook.entryCount).toBe(6)
    expect(wordbook.name).toBe('五年级上册单词表')
  })

  it('rejects quizzes smaller than four distinct entries', async () => {
    const service = new WordbookService(new InMemoryWordbookRepository())
    const wordbook = await service.import({
      familyId,
      createdBy,
      fileName: 'tiny.docx',
      sourceType: 'docx',
      text: 'apple 苹果\nbanana 香蕉',
    })
    await service.confirm({ familyId, id: wordbook.id, createdBy })

    await expect(
      service.createQuiz({
        familyId,
        kidId,
        createdBy,
        wordbookId: wordbook.id,
        direction: 'en_to_zh',
        count: 2,
        deliveryMode: 'passport',
      }),
    ).rejects.toThrow('WORDBOOK_TOO_SMALL')
  })

  it('builds four distinct options with a matching answer key', async () => {
    const { service, wordbook } = await seedWordbook()

    const { quiz, questions } = await service.createQuiz({
      familyId,
      kidId,
      createdBy,
      wordbookId: wordbook.id,
      direction: 'en_to_zh',
      count: 5,
      deliveryMode: 'passport',
    })

    expect(quiz.questionCount).toBe(5)
    expect(questions).toHaveLength(5)
    for (const question of questions) {
      expect(question.options).toHaveLength(4)
      expect(new Set(question.options.map((option) => option.text)).size).toBe(4)
      const answer = question.options.find(
        (option) => option.key === question.answerKey,
      )
      expect(answer).toBeTruthy()
    }
  })

  it('uses the chinese meaning as the stem when translating zh to en', async () => {
    const { service, wordbook } = await seedWordbook()

    const { questions } = await service.createQuiz({
      familyId,
      kidId,
      createdBy,
      wordbookId: wordbook.id,
      direction: 'zh_to_en',
      count: 3,
      deliveryMode: 'web',
    })

    for (const question of questions) {
      expect(/[\u4e00-\u9fff]/.test(question.stem)).toBe(true)
      expect(
        question.options.every((option) => /^[A-Za-z' -]+$/.test(option.text)),
      ).toBe(true)
    }
  })

  it('records wrong words and masters them after two correct answers', async () => {
    const { service, wordbook } = await seedWordbook()
    const first = await service.createQuiz({
      familyId,
      kidId,
      createdBy,
      wordbookId: wordbook.id,
      direction: 'en_to_zh',
      count: 6,
      deliveryMode: 'passport',
    })
    const wrongAnswers = first.questions.map((question, index) => ({
      questionId: question.id,
      selectedKey:
        index < 4
          ? (['A', 'B', 'C', 'D'] as const).find(
              (key) => key !== question.answerKey,
            )!
          : question.answerKey,
    }))

    const submitted = await service.submitAnswers({
      familyId,
      kidId,
      quizId: first.quiz.id,
      answers: wrongAnswers,
    })

    expect(submitted.accepted).toHaveLength(6)
    expect(submitted.results.filter((item) => !item.isCorrect)).toHaveLength(4)
    const wrong = await service.listWrongItems(familyId, kidId, 'active')
    expect(wrong).toHaveLength(4)

    for (let round = 0; round < 2; round += 1) {
      const retry = await service.createQuiz({
        familyId,
        kidId,
        createdBy,
        wordbookId: wordbook.id,
        direction: 'en_to_zh',
        count: 6,
        deliveryMode: 'passport',
      })
      await service.submitAnswers({
        familyId,
        kidId,
        quizId: retry.quiz.id,
        answers: retry.questions.map((question) => ({
          questionId: question.id,
          selectedKey: question.answerKey,
        })),
      })
    }

    const stats = await service.stats(familyId, kidId)
    expect(stats.totalAnswers).toBe(18)
    expect(stats.wrongItems.active).toBe(0)
    expect(stats.wrongItems.mastered).toBe(4)
  })
})
