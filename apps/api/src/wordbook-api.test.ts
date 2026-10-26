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
  it('delivers fifty questions in bounded batches and resumes only unanswered questions', async () => {
    const { app, wordbookService } = await createApp()
    const parentCookie = await login(app, 'parent')
    const childCookie = await login(app, 'child')
    const seeded = await wordbookService.import({
      familyId, createdBy: parentId, fileName: 'fifty.txt', sourceType: 'text',
      text: Array.from({ length: 50 }, (_, i) =>
        `word${String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26)} 词义${i}`,
      ).join('\n'),
    })
    await wordbookService.confirm({ familyId, createdBy: parentId, id: seeded.id })
    const created = await app.inject({
      method: 'POST', url: '/v1/word-quizzes',
      cookies: { kid_study_session: parentCookie },
      payload: { wordbookId: seeded.id, direction: 'en_to_zh', count: 50, deliveryMode: 'passport' },
    })
    expect(created.statusCode).toBe(201)
    const quizId = created.json().quiz.id
    const seen = new Set<string>()
    for (let round = 0; round < 7; round++) {
      const fetched = await app.inject({
        method: 'GET', url: '/v1/passport/word-training',
        cookies: { kid_study_session: childCookie },
      })
      const batch = fetched.json().questions as Array<{ id: string }>
      expect(batch.length).toBeGreaterThan(0)
      expect(batch.length).toBeLessThanOrEqual(8)
      expect(Buffer.byteLength(fetched.body)).toBeLessThan(24 * 1024)
      expect(fetched.body).not.toContain('answerKey')
      for (const question of batch) {
        expect(seen.has(question.id)).toBe(false)
        seen.add(question.id)
      }
      const submitted = await app.inject({
        method: 'POST', url: `/v1/word-quizzes/${quizId}/answers`,
        cookies: { kid_study_session: childCookie },
        payload: { answers: batch.map(({ id }) => ({
          questionId: id, selectedKey: 'A', clientEventId: `device-${id}`,
        })) },
      })
      expect(submitted.statusCode).toBe(200)
      expect(submitted.json().completed).toBe(round === 6)
    }
    expect(seen.size).toBe(50)
  })

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
    expect(questions.every((question) => !('answerKey' in question))).toBe(true)
    expect(fetched.json().progress).toEqual([])
    const passport = await app.inject({
      method: 'GET', url: '/v1/passport/word-training',
      cookies: { kid_study_session: childCookie },
    })
    expect(passport.statusCode).toBe(200)
    expect(passport.json().quiz.id).toBe(quizId)
    expect(passport.body).not.toContain('answerKey')

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
    expect(submitted.json().completed).toBe(true)
    const restored = await app.inject({
      method: 'GET', url: `/v1/word-quizzes/${quizId}`,
      cookies: { kid_study_session: childCookie },
    })
    expect(restored.json().progress).toHaveLength(3)
    expect(restored.json().quiz.status).toBe('completed')
    const emptyPassport = await app.inject({
      method: 'GET', url: '/v1/passport/word-training',
      cookies: { kid_study_session: childCookie },
    })
    expect(emptyPassport.json().quiz).toBeNull()

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
