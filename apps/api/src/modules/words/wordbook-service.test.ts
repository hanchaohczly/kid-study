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

async function seedWordbook() {
  const service = new WordbookService(new InMemoryWordbookRepository())
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
