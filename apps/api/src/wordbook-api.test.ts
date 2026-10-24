import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { InMemoryEventRepository } from './modules/events/in-memory-event-repository.js'
import { InMemoryContentRepository } from './modules/content/in-memory-content-repository.js'
import { InMemoryModelConfigRepository } from './modules/models/in-memory-model-config-repository.js'
import { InMemoryWordbookRepository } from './modules/words/in-memory-wordbook-repository.js'
import { WordbookService } from './modules/words/wordbook-service.js'

const apps: FastifyInstance[] = []
const familyId = '11111111-1111-4111-8111-111111111111'
const parentId = '22222222-2222-4222-8222-222222222222'

const sampleText = [
  'apple n. 苹果',
  'banana n. 香蕉',
  'cat n. 猫',
  'dog n. 狗',
  'egg n. 鸡蛋',
].join('\n')

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

async function createApp() {
  const wordbookService = new WordbookService(
    new InMemoryWordbookRepository(),
  )
  const app = await buildApp({
    config: loadConfig({
      JWT_SECRET: 'test-secret-with-enough-entropy',
      DEV_PARENT_PASSWORD: 'parent-test',
      DEV_CHILD_PIN: '1357',
    }),
    eventRepository: new InMemoryEventRepository(),
    contentRepository: new InMemoryContentRepository(),
    modelConfigRepository: new InMemoryModelConfigRepository(),
    wordbookService,
    startSchedulers: false,
    logger: false,
  })
  apps.push(app)
  return { app, wordbookService }
}

async function login(
  app: FastifyInstance,
  role: 'parent' | 'child',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: {
      role,
      credential: role === 'parent' ? 'parent-test' : '1357',
    },
  })
  expect(response.statusCode).toBe(200)
  return response.cookies[0]!.value
}

describe('wordbook API', () => {
  it('runs the full import, confirm, quiz and answer flow', async () => {
    const { app, wordbookService } = await createApp()
    const parentCookie = await login(app, 'parent')
    const childCookie = await login(app, 'child')

    const seeded = await wordbookService.import({
      familyId,
      createdBy: parentId,
      fileName: '三年级单词.docx',
      sourceType: 'docx',
      text: sampleText,
    })
    expect(seeded.entryCount).toBe(5)

    const confirmed = await app.inject({
      method: 'POST',
      url: `/v1/wordbooks/${seeded.id}/confirm`,
      cookies: { kid_study_session: parentCookie },
    })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().wordbook.status).toBe('confirmed')

    const created = await app.inject({
      method: 'POST',
      url: '/v1/word-quizzes',
      cookies: { kid_study_session: parentCookie },
      payload: {
        wordbookId: seeded.id,
        direction: 'en_to_zh',
        count: 3,
        deliveryMode: 'passport',
      },
    })
    expect(created.statusCode).toBe(201)
    const quizId = created.json().quiz.id as string

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/word-quizzes/${quizId}`,
      cookies: { kid_study_session: childCookie },
    })
    expect(fetched.statusCode).toBe(200)
    const questions = fetched.json().questions as Array<{
      id: string
      answerKey?: string
      options: Array<{ key: string; text: string }>
    }>
    expect(questions).toHaveLength(3)
    expect(questions.every((question) => question.answerKey)).toBe(true)

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/word-quizzes/${quizId}/answers`,
      cookies: { kid_study_session: childCookie },
      payload: {
        answers: questions.map((question) => ({
          questionId: question.id,
          selectedKey: 'A',
          clientEventId: `event-${question.id}`,
        })),
      },
    })
    expect(submitted.statusCode).toBe(200)
    expect(submitted.json().accepted).toHaveLength(3)
    expect(submitted.json().results).toHaveLength(3)

    const stats = await app.inject({
      method: 'GET',
      url: '/v1/word-stats',
      cookies: { kid_study_session: childCookie },
    })
    expect(stats.statusCode).toBe(200)
    expect(stats.json().totalAnswers).toBe(3)

    const wrong = await app.inject({
      method: 'GET',
      url: '/v1/word-wrong-items?status=active',
      cookies: { kid_study_session: childCookie },
    })
    expect(wrong.statusCode).toBe(200)
    expect(Array.isArray(wrong.json().items)).toBe(true)
  })

  it('rejects wordbook management for a child token', async () => {
    const { app } = await createApp()
    const childCookie = await login(app, 'child')

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/wordbooks',
      cookies: { kid_study_session: childCookie },
    })

    expect(listed.statusCode).toBe(404)
  })
})
