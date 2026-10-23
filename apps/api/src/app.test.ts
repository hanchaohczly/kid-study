import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { InMemoryEventRepository } from './modules/events/in-memory-event-repository.js'
import type { QuestionGenerator } from './modules/assessments/assessment-service.js'
import { InMemoryModelConfigRepository } from './modules/models/in-memory-model-config-repository.js'
import { InMemoryContentRepository } from './modules/content/in-memory-content-repository.js'
import {
  TextbookImportService,
  type TextbookChunkProgress,
} from './modules/textbooks/textbook-import-service.js'
import type { PhotoWrongAnalyzer } from './modules/wrong-book/wrong-book-service.js'

const apps: FastifyInstance[] = []
const questionGenerator: QuestionGenerator = {
  isConfigured() {
    return true
  },
  async generate(input) {
    return Array.from({ length: input.count }, (_, index) => {
      const questionType = input.questionTypes[index]!
      return {
      kpId: input.knowledgePoints[index % input.knowledgePoints.length]!.id,
      stem: `本次动态生成的第 ${index + 1} 道考察题？`,
      questionType,
      options:
        questionType === 'single_choice'
          ? [
              { key: 'A' as const, text: '正确应用知识点' },
              { key: 'B' as const, text: '错误选项一' },
              { key: 'C' as const, text: '错误选项二' },
              { key: 'D' as const, text: '错误选项三' },
            ]
          : [],
      difficulty: 4 as const,
      answerKey: questionType === 'single_choice' ? 'A' : '完整参考解答',
      referenceSteps: ['识别目标知识点'],
      scoringPoints: ['正确应用知识点'],
      hints: ['回忆定义。', '检查条件。', '逐项排除不符合条件的选项。'],
      optionHints: {
        A: ['检查所选项使用的定义。', '逐条核对所选项的条件。', '找出所选项与定义不一致之处。'],
        B: ['检查所选项使用的定义。', '逐条核对所选项的条件。', '找出所选项与定义不一致之处。'],
        C: ['检查所选项使用的定义。', '逐条核对所选项的条件。', '找出所选项与定义不一致之处。'],
        D: ['检查所选项使用的定义。', '逐条核对所选项的条件。', '找出所选项与定义不一致之处。'],
      },
    }
    })
  },
}

async function createApp(
  generator: QuestionGenerator = questionGenerator,
  photoWrongAnalyzer?: PhotoWrongAnalyzer,
): Promise<FastifyInstance> {
  const app = await buildApp({
    config: loadConfig({
      JWT_SECRET: 'test-secret-with-enough-entropy',
      DEV_PARENT_PASSWORD: 'parent-test',
      DEV_CHILD_PIN: '1357',
    }),
    eventRepository: new InMemoryEventRepository(),
    contentRepository: new InMemoryContentRepository({
      seedDemoContent: true,
    }),
    modelConfigRepository: new InMemoryModelConfigRepository(),
    questionGenerator: generator,
    startSchedulers: false,
    ...(photoWrongAnalyzer ? { photoWrongAnalyzer } : {}),
    logger: false,
  })
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  vi.unstubAllGlobals()
})

describe('API', () => {
  it('exposes Prometheus health and request metrics', async () => {
    const app = await createApp()
    await app.inject({ method: 'GET', url: '/health/live' })

    const response = await app.inject({ method: 'GET', url: '/metrics' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/plain')
    expect(response.body).toContain('kid_study_http_requests_total')
    expect(response.body).toContain('route="/health/live"')
    expect(response.body).toContain('kid_study_process_resident_memory_bytes')
  })

  it('keeps health checks outside rate limits and returns 429 for login abuse', async () => {
    const app = await createApp()
    const healthResponses = await Promise.all(
      Array.from({ length: 130 }, () =>
        app.inject({ method: 'GET', url: '/health/live' }),
      ),
    )
    const loginResponses = []
    for (let index = 0; index < 6; index += 1) {
      loginResponses.push(
        await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { role: 'child', credential: '1357' },
        }),
      )
    }

    expect(healthResponses.every((response) => response.statusCode === 200)).toBe(
      true,
    )
    expect(loginResponses.at(-1)?.statusCode).toBe(429)
    expect(loginResponses.at(-1)?.json()).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    })
  })

  it('requires authentication for event ingestion', async () => {
    const app = await createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: { events: [] },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('logs in a child and ingests a valid event idempotently', async () => {
    const app = await createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'child', credential: '1357' },
    })
    const cookie = login.cookies[0]?.value
    expect(login.statusCode).toBe(200)
    expect(cookie).toBeTruthy()

    const payload = {
      events: [
        {
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          schemaVersion: 1,
          type: 'training_started',
          createdAtLocal: '2026-10-10T08:00:00+08:00',
          localSeq: 1,
          kpIds: [],
          payload: {
            planId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
        },
      ],
    }
    const request = () =>
      app.inject({
        method: 'POST',
        url: '/v1/events',
        cookies: { kid_study_session: cookie! },
        payload,
      })

    const first = await request()
    const second = await request()

    expect(first.statusCode).toBe(200)
    expect(first.json().results[0].status).toBe('accepted')
    expect(second.json().results[0].status).toBe('duplicated')
  })

  it('does not expose the development event view to a child', async () => {
    const app = await createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'child', credential: '1357' },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/dev/events',
      cookies: { kid_study_session: login.cookies[0]!.value },
    })

    expect(response.statusCode).toBe(404)
  })

  it('exposes mastery evidence only to a parent', async () => {
    const app = await createApp()
    const [parentLogin, childLogin] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { role: 'parent', credential: 'parent-test' },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { role: 'child', credential: '1357' },
      }),
    ])

    const [parentResponse, childResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/v1/mastery',
        cookies: {
          kid_study_session: parentLogin.cookies[0]!.value,
        },
      }),
      app.inject({
        method: 'GET',
        url: '/v1/mastery',
        cookies: {
          kid_study_session: childLogin.cookies[0]!.value,
        },
      }),
    ])

    expect(parentResponse.statusCode).toBe(200)
    expect(parentResponse.json()).toMatchObject({
      modelVersion: 'm1-v2-four-dimensions',
      summary: {
        mastered: 0,
        hintDependent: 0,
        needsReview: 0,
        insufficient: 0,
      },
      projections: [],
    })
    expect(childResponse.statusCode).toBe(404)
  })

  it('clears the session cookie on logout without requiring a request body', async () => {
    const app = await createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'child', credential: '1357' },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      cookies: { kid_study_session: login.cookies[0]!.value },
    })

    expect(response.statusCode).toBe(204)
    expect(response.cookies[0]).toMatchObject({
      name: 'kid_study_session',
      value: '',
      path: '/',
    })
  })

  it('does not expose content management to a child', async () => {
    const app = await createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'child', credential: '1357' },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/content',
      cookies: { kid_study_session: login.cookies[0]!.value },
    })

    expect(response.statusCode).toBe(404)
  })

  it('lets a parent configure model capabilities without exposing API keys', async () => {
    const app = await createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })
    const cookie = login.cookies[0]!.value
    const saved = await app.inject({
      method: 'PUT',
      url: '/v1/model-configs/chat',
      cookies: { kid_study_session: cookie },
      payload: {
        enabled: true,
        primary: {
          baseUrl: 'https://gateway.example/v1/chat/completions',
          model: 'chat-model',
          apiKey: 'private-api-key-1234',
        },
        retryCount: 2,
        timeoutMs: 90_000,
      },
    })
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/model-configs',
      cookies: { kid_study_session: cookie },
    })
    const textbooks = await app.inject({
      method: 'GET',
      url: '/v1/textbooks',
      cookies: { kid_study_session: cookie },
    })

    expect(saved.statusCode).toBe(200)
    expect(saved.json().capability.primary).toMatchObject({
      apiKeyMasked: '••••••••1234',
      hasApiKey: true,
    })
    expect(JSON.stringify(listed.json())).not.toContain('private-api-key-1234')
    expect(textbooks.json().configured).toBe(true)
    expect(listed.json().usage).toMatchObject({
      chat: expect.arrayContaining(['教材结构化', '动态出题']),
      embedding: expect.arrayContaining(['教材语义检索']),
      vision: expect.arrayContaining(['扫描教材识别']),
    })
  })

  it('explains that textbook analysis requires Chat when only Embedding is configured', async () => {
    const app = await createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })
    const cookie = login.cookies[0]!.value
    await app.inject({
      method: 'PUT',
      url: '/v1/model-configs/embedding',
      cookies: { kid_study_session: cookie },
      payload: {
        enabled: true,
        primary: {
          baseUrl: 'https://gateway.example/v1',
          model: 'embedding-model',
          apiKey: 'private-api-key',
        },
        retryCount: 1,
        timeoutMs: 60_000,
      },
    })

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/textbooks',
      cookies: { kid_study_session: cookie },
    })
    const upload = await app.inject({
      method: 'POST',
      url: '/v1/textbooks/upload',
      cookies: { kid_study_session: cookie },
    })

    expect(listed.json()).toMatchObject({
      configured: false,
      requiredCapability: 'chat',
    })
    expect(upload.statusCode).toBe(409)
    expect(upload.json()).toMatchObject({
      code: 'CHAT_MODEL_NOT_CONFIGURED',
      retryable: false,
    })
    expect(upload.json().message).toContain('Embedding 模型仅用于语义检索')
  })

  it('lets a parent query the current textbook analysis progress', async () => {
    const app = await createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/textbooks/progress',
      cookies: { kid_study_session: login.cookies[0]!.value },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ progress: null })
  })

  it('reports live textbook chunk progress and completion to a parent', async () => {
    let releaseAnalysis!: () => void
    const analysisPaused = new Promise<void>((resolve) => {
      releaseAnalysis = resolve
    })
    const textbookImportService = new TextbookImportService(
      new InMemoryContentRepository(),
      {
        async extract() {
          return { text: '教材正文 '.repeat(200), pageCount: 20 }
        },
      },
      {
        isConfigured() {
          return true
        },
        async analyze(
          _familyId,
          _fileName,
          _text,
          onProgress?: (progress: TextbookChunkProgress) => void,
        ) {
          onProgress?.({ completedChunks: 1, totalChunks: 4 })
          await analysisPaused
          onProgress?.({ completedChunks: 4, totalChunks: 4 })
          return {
            title: '八年级数学上册',
            subject: '数学' as const,
            grade: '八年级',
            edition: '测试版',
            chapters: [
              {
                code: 'CH-01',
                title: '测试章节',
                pageStart: 1,
                pageEnd: 20,
                knowledgePoints: [],
              },
            ],
          }
        },
      },
    )
    const app = await buildApp({
      config: loadConfig({
        JWT_SECRET: 'test-secret-with-enough-entropy',
        DEV_PARENT_PASSWORD: 'parent-test',
        DEV_CHILD_PIN: '1357',
      }),
      eventRepository: new InMemoryEventRepository(),
      modelConfigRepository: new InMemoryModelConfigRepository(),
      questionGenerator,
      textbookImportService,
      logger: false,
    })
    apps.push(app)
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })
    const upload = textbookImportService.upload(
      '11111111-1111-4111-8111-111111111111',
      'math.pdf',
      new TextEncoder().encode('%PDF-test'),
    )
    await vi.waitFor(() => {
      expect(textbookImportService.getProgress(
        '11111111-1111-4111-8111-111111111111',
      )?.status).toBe('analyzing')
    })

    const running = await app.inject({
      method: 'GET',
      url: '/v1/textbooks/progress',
      cookies: { kid_study_session: login.cookies[0]!.value },
    })
    expect(running.json().progress).toMatchObject({
      status: 'analyzing',
      completedChunks: 1,
      totalChunks: 4,
    })

    releaseAnalysis()
    await upload
    const completed = await app.inject({
      method: 'GET',
      url: '/v1/textbooks/progress',
      cookies: { kid_study_session: login.cookies[0]!.value },
    })
    expect(completed.json().progress).toMatchObject({
      status: 'completed',
      percent: 100,
      completedChunks: 4,
      totalChunks: 4,
    })
  })

  it('lets a parent load models while reusing the saved API key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'chat-pro' }, { id: 'chat-lite' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = await createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })
    const cookie = login.cookies[0]!.value
    await app.inject({
      method: 'PUT',
      url: '/v1/model-configs/chat',
      cookies: { kid_study_session: cookie },
      payload: {
        enabled: true,
        primary: {
          baseUrl: 'https://gateway.example/v1/chat/completions',
          model: 'chat-pro',
          apiKey: 'private-api-key',
        },
        retryCount: 1,
        timeoutMs: 60_000,
      },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-configs/chat/models',
      cookies: { kid_study_session: cookie },
      payload: {
        target: 'primary',
        baseUrl: 'https://gateway.example/v1/chat/completions',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ models: ['chat-lite', 'chat-pro'] })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://gateway.example/v1/models',
    )
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer private-api-key')
  })

  it('generates and assigns questions when a parent starts an assessment', async () => {
    const app = await createApp()
    const parentLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })
    const parentCookie = parentLogin.cookies[0]!.value

    const assessmentResponse = await app.inject({
      method: 'POST',
      url: '/v1/assessments',
      cookies: { kid_study_session: parentCookie },
      payload: {
        knowledgePointIds: ['20000000-0000-4000-8000-000000000001'],
        purpose: '检查今天所学内容',
        count: 2,
      },
    })
    expect(assessmentResponse.statusCode).toBe(201)
    const assessment = assessmentResponse.json().assessment
    expect(assessment).toMatchObject({
      trigger: 'parent_initiated',
      purpose: '检查今天所学内容',
    })
    expect(assessment.questionIds).toHaveLength(2)

    const childLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'child', credential: '1357' },
    })
    const trainingResponse = await app.inject({
      method: 'GET',
      url: '/v1/training/today',
      cookies: { kid_study_session: childLogin.cookies[0]!.value },
    })
    const training = trainingResponse.json()
    expect(trainingResponse.statusCode).toBe(200)
    expect(training.questions).toHaveLength(2)
    expect(training.questions[0]).toMatchObject({
      stem: '本次动态生成的第 1 道考察题？',
      kpId: '20000000-0000-4000-8000-000000000001',
    })
    expect(JSON.stringify(training)).not.toContain('answerKey')
    expect(JSON.stringify(training)).not.toContain('hints')
  })

  it('returns a retryable gateway error when question generation is unavailable', async () => {
    const unavailableGenerator: QuestionGenerator = {
      isConfigured: () => true,
      generate: async () => {
        throw new Error('LLM_REQUEST_FAILED:503')
      },
    }
    const app = await createApp(unavailableGenerator)
    const parentLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/assessments',
      cookies: {
        kid_study_session: parentLogin.cookies[0]!.value,
      },
      payload: {
        knowledgePointIds: ['20000000-0000-4000-8000-000000000001'],
        purpose: '检查今天所学内容',
        count: 1,
      },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({
      code: 'LLM_QUESTION_GENERATION_UNAVAILABLE',
      message: '题目生成模型暂时不可用，请稍后重试',
      retryable: true,
    })
  })

  it('does not expose manual content creation endpoints', async () => {
    const app = await createApp()
    const parentLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/content/questions',
      cookies: { kid_study_session: parentLogin.cookies[0]!.value },
      payload: {},
    })
    expect(response.statusCode).toBe(404)
  })

  it('does not check or hint a question that was not assigned to the child', async () => {
    const app = await createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'child', credential: '1357' },
    })
    const cookie = login.cookies[0]!.value
    const questionId = '10000000-0000-4000-8000-000000000001'

    const [answer, hint] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/answers/check',
        cookies: { kid_study_session: cookie },
        payload: {
          attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          questionId,
          answer: 'B',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/guide',
        cookies: { kid_study_session: cookie },
        payload: {
          attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          questionId,
          selectedAnswer: 'A',
          kidInput: '不会',
        },
      }),
    ])

    expect(answer.statusCode).toBe(404)
    expect(hint.statusCode).toBe(404)
  })

  it('adds an incorrect system answer to the wrong book without exposing the answer to the child', async () => {
    const app = await createApp()
    const parentLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })
    const parentCookie = parentLogin.cookies[0]!.value
    const assessmentResponse = await app.inject({
      method: 'POST',
      url: '/v1/assessments',
      cookies: { kid_study_session: parentCookie },
      payload: {
        knowledgePointIds: ['20000000-0000-4000-8000-000000000001'],
        purpose: '错题集链路验证',
        count: 1,
      },
    })
    const questionId = assessmentResponse.json().assessment.questionIds[0]
    const childLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'child', credential: '1357' },
    })
    const childCookie = childLogin.cookies[0]!.value
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await app.inject({
      method: 'POST',
      url: '/v1/training/attempts/start',
      cookies: { kid_study_session: childCookie },
      payload: { attemptId, questionId },
    })
    const answer = await app.inject({
      method: 'POST',
      url: '/v1/answers/check',
      cookies: { kid_study_session: childCookie },
      payload: {
        submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        attemptId,
        questionId,
        answer: 'B',
      },
    })

    const [parentItems, childItems] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/v1/wrong-items?status=active',
        cookies: { kid_study_session: parentCookie },
      }),
      app.inject({
        method: 'GET',
        url: '/v1/wrong-items?status=active',
        cookies: { kid_study_session: childCookie },
      }),
    ])

    expect(answer.statusCode).toBe(200)
    expect(answer.json().correct).toBe(false)
    expect(parentItems.json().items[0]).toMatchObject({
      source: 'system',
      questionId,
      studentAnswer: 'B',
      answerKey: 'A',
      wrongCount: 1,
    })
    expect(JSON.stringify(childItems.json())).not.toContain('answerKey')
    expect(JSON.stringify(childItems.json())).not.toContain('analysis')
  })

  it('recognizes a photographed wrong item and serves the original image only after authentication', async () => {
    const photoAnalyzer: PhotoWrongAnalyzer = {
      isConfigured: () => true,
      async analyze() {
        return {
          stem: '解方程 3x + 5 = 20。',
          studentAnswer: 'x = 4',
          answerKey: 'x = 5',
          analysis: '移项时应保持等式两边进行相同运算。',
          kpId: '20000000-0000-4000-8000-000000000001',
          mappingConfidence: 0.94,
        }
      },
    }
    const app = await createApp(questionGenerator, photoAnalyzer)
    const parentLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { role: 'parent', credential: 'parent-test' },
    })
    const cookie = parentLogin.cookies[0]!.value
    const image = Buffer.from('fake-jpeg')
    const response = await app.inject({
      method: 'POST',
      url: '/v1/wrong-items/photo',
      cookies: { kid_study_session: cookie },
      payload: multipartImage(image),
      headers: {
        'content-type':
          'multipart/form-data; boundary=----wrong-item-boundary',
      },
    })
    expect(response.statusCode).toBe(201)
    const item = response.json().item
    expect(item).toMatchObject({
      source: 'photo',
      knowledgePointName: '一元一次方程',
      mappingConfidence: 0.94,
    })

    const [authorized, anonymous] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/v1/wrong-items/${item.id}/photo`,
        cookies: { kid_study_session: cookie },
      }),
      app.inject({
        method: 'GET',
        url: `/v1/wrong-items/${item.id}/photo`,
      }),
    ])
    expect(authorized.statusCode).toBe(200)
    expect(authorized.rawPayload).toEqual(image)
    expect(anonymous.statusCode).toBe(401)
  })
})

function multipartImage(image: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      [
        '------wrong-item-boundary',
        'Content-Disposition: form-data; name="file"; filename="wrong.jpg"',
        'Content-Type: image/jpeg',
        '',
        '',
      ].join('\r\n'),
    ),
    image,
    Buffer.from('\r\n------wrong-item-boundary--\r\n'),
  ])
}
