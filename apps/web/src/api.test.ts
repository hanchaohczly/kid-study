import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkAnswer,
  fetchModelOptions,
  getTextbookProgress,
  login,
  logout,
  requestHint,
  submitMasteryReview,
} from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API client', () => {
  it('sends a valid empty JSON object when logging out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await logout()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('sets JSON content type for requests with a JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: '33333333-3333-4333-8333-333333333333',
            role: 'child',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await login('child', '2468')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('requests model options without sending an empty API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: ['model-a', 'model-b'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await fetchModelOptions('chat', {
      target: 'primary',
      baseUrl: 'https://gateway.example/v1',
    })

    expect(models).toEqual(['model-a', 'model-b'])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/model-configs/chat/models')
    expect(JSON.parse(String(init.body))).toEqual({
      target: 'primary',
      baseUrl: 'https://gateway.example/v1',
    })
  })

  it('loads the current textbook analysis progress', async () => {
    const progress = {
      jobId: 'job-1',
      fileName: 'math.pdf',
      status: 'analyzing',
      percent: 53,
      message: '正在分析第 4/8 个分块',
      completedChunks: 3,
      totalChunks: 8,
      startedAt: '2026-10-10T08:00:00.000Z',
      updatedAt: '2026-10-10T08:03:00.000Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ progress }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getTextbookProgress()).resolves.toEqual(progress)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/textbooks/progress',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('sends the selected option with a hint request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          attemptId: 'attempt-1',
          guideAttemptId: 'guide-1',
          text: '检查这个选项使用的条件。',
          hintLevel: 1,
          safetyResult: 'pass',
          policyVersion: 'test-v1',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await requestHint({
      attemptId: 'attempt-1',
      questionId: 'question-1',
      selectedAnswer: 'C',
      kidInput: '我选择了 C。',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      selectedAnswer: 'C',
    })
  })

  it('sends an idempotency id with an answer submission', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          correct: true,
          nextAction: 'continue',
          budget: {
            serverStartedAt: '2026-10-10T08:00:00.000Z',
            elapsedSeconds: 10,
            remainingSeconds: 1790,
            stopAddingQuestions: false,
            sessionClosed: false,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await checkAnswer({
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      questionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      answer: 'B',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      answer: 'B',
    })
  })

  it('submits the projection version with a parent review', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ review: { id: 'review-1' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await submitMasteryReview(
      '20000000-0000-4000-8000-000000000001',
      {
        projectionVersion: 3,
        decision: 'disagree',
        note: '最近一次仍需口头提醒',
      },
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/mastery/')
    expect(JSON.parse(String(init.body))).toEqual({
      projectionVersion: 3,
      decision: 'disagree',
      note: '最近一次仍需口头提醒',
    })
  })
})
