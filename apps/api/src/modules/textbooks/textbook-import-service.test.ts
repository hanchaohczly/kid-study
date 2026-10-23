import { describe, expect, it } from 'vitest'
import { InMemoryContentRepository } from '../content/in-memory-content-repository.js'
import {
  InMemoryTextbookImportRepository,
  OpenAiCompatibleTextbookAnalyzer,
  TextbookImportService,
  textbookDraftSchema,
  type PdfTextExtractor,
  type TextbookAnalyzer,
  type TextbookDraft,
} from './textbook-import-service.js'
import type { ModelRouter } from '../models/model-router.js'

const familyId = '11111111-1111-4111-8111-111111111111'

function draft(): TextbookDraft {
  return {
    title: '八年级数学上册',
    subject: '数学',
    grade: '八年级',
    edition: '测试版',
    chapters: [
      {
        code: 'CH-01',
        title: '第三章 测试章节',
        pageStart: 1,
        pageEnd: 20,
        knowledgePoints: [
          {
            code: 'M8-TEST-01',
            name: '测试知识点',
            summary: '用于验证教材自动导入。',
            pageStart: 2,
            pageEnd: 4,
            prerequisiteCodes: [],
          },
        ],
      },
    ],
  }
}

const extractor: PdfTextExtractor = {
  async extract() {
    return { text: '教材正文 '.repeat(200), pageCount: 20 }
  },
}

const analyzer: TextbookAnalyzer = {
  isConfigured() {
    return true
  },
  async analyze() {
    return draft()
  },
}

describe('TextbookImportService', () => {
  it('starts the in-memory content repository without demo content', async () => {
    const repository = new InMemoryContentRepository()

    expect(await repository.listKnowledgePoints(familyId)).toEqual([])
    expect(await repository.listQuestionsForParent(familyId)).toEqual([])
  })

  it('orders published knowledge points by source pages with stable fallbacks', async () => {
    const repository = new InMemoryContentRepository()
    const baseInput = {
      name: '测试知识点',
      chapter: '第十四章 全等三角形',
      status: 'published' as const,
    }

    await repository.createKnowledgePoint(familyId, {
      ...baseInput,
      code: 'KP14-10',
      sourcePageStart: 40,
      sourcePageEnd: 42,
    })
    await repository.createKnowledgePoint(familyId, {
      ...baseInput,
      code: 'KP14-2',
      sourcePageStart: 40,
      sourcePageEnd: 42,
    })
    await repository.createKnowledgePoint(familyId, {
      ...baseInput,
      code: 'KP14-02',
      sourcePageStart: 35,
      sourcePageEnd: 36,
    })
    await repository.createKnowledgePoint(familyId, {
      ...baseInput,
      code: 'KP14-01',
    })

    expect(
      (await repository.listKnowledgePoints(familyId)).map((item) => item.code),
    ).toEqual(['KP14-02', 'KP14-2', 'KP14-10', 'KP14-01'])
  })

  it('extracts a PDF and publishes only the confirmed knowledge structure', async () => {
    const repository = new InMemoryContentRepository()
    const service = new TextbookImportService(repository, extractor, analyzer)
    const uploaded = await service.upload(
      familyId,
      'math.pdf',
      new TextEncoder().encode('%PDF-test'),
    )

    expect(uploaded).toMatchObject({
      fileName: 'math.pdf',
      pageCount: 20,
      status: 'ready_for_review',
    })
    expect(uploaded.draft.chapters[0]?.knowledgePoints[0]?.name).toBe(
      '测试知识点',
    )
    expect(service.getProgress(familyId)).toMatchObject({
      fileName: 'math.pdf',
      status: 'completed',
      percent: 100,
      message: '教材分析完成',
    })

    await service.confirm(familyId, uploaded.id)
    const knowledgePoints = await repository.listKnowledgePoints(familyId)
    const questions = await repository.listQuestionsForParent(familyId)
    expect(
      knowledgePoints.find((item) => item.code === 'M8-TEST-01'),
    ).toMatchObject({
      summary: '用于验证教材自动导入。',
      sourcePageStart: 2,
      sourcePageEnd: 4,
    })
    expect(questions).toHaveLength(0)
    expect((await service.get(familyId, uploaded.id))?.status).toBe('confirmed')
  })

  it('rejects PDFs without enough extractable text', async () => {
    const service = new TextbookImportService(
      new InMemoryContentRepository(),
      {
        async extract() {
          return { text: '扫描图片', pageCount: 10 }
        },
      },
      analyzer,
    )

    await expect(
      service.upload(
        familyId,
        'scan.pdf',
        new TextEncoder().encode('%PDF-test'),
      ),
    ).rejects.toThrow('PDF_TEXT_LAYER_REQUIRED')
  })

  it('rejects question data in a textbook analysis draft', () => {
    const unsafe = structuredClone(draft()) as unknown as Record<string, unknown>
    const chapters = unsafe.chapters as Array<{
      knowledgePoints: Array<Record<string, unknown>>
    }>
    chapters[0]!.knowledgePoints[0]!.questions = [{ stem: '不应预生成' }]

    expect(textbookDraftSchema.strict().safeParse(unsafe).success).toBe(false)
  })

  it('keeps each initial textbook model request within 8000 characters', async () => {
    const segmentLengths: number[] = []
    const router = {
      isConfigured() {
        return true
      },
      async chatJson(
        _familyId: string,
        request: { messages: Array<{ role: string; content: string }> },
      ) {
        const payload = JSON.parse(request.messages[1]!.content) as {
          textbookText: string
        }
        segmentLengths.push(payload.textbookText.length)
        return {
          data: draft(),
          model: 'test-model',
          attempts: 1,
          usedFallback: false,
        }
      },
    } as ModelRouter
    const text = Array.from(
      { length: 8 },
      (_, index) => `--- PAGE ${index + 1} ---\n${'教材内容'.repeat(1_500)}`,
    ).join('\n')

    await new OpenAiCompatibleTextbookAnalyzer(router).analyze(
      familyId,
      'math.pdf',
      text,
    )

    expect(segmentLengths.length).toBeGreaterThan(1)
    expect(Math.max(...segmentLengths)).toBeLessThanOrEqual(8_000)
  })

  it('merges chapter title variants across analysis chunks', async () => {
    let modelCalls = 0
    const router = {
      isConfigured() {
        return true
      },
      async chatJson() {
        modelCalls += 1
        const officialTitle = modelCalls === 2
        return {
          data: {
            ...draft(),
            chapters: [
              {
                code: officialTitle ? 'CH14' : 'C14',
                title: officialTitle
                  ? '第十四章 - 全等三角形'
                  : '全等三角形',
                pageStart: officialTitle ? 35 : 40,
                pageEnd: officialTitle ? 39 : 45,
                knowledgePoints: [
                  {
                    code: officialTitle ? 'KP14-01' : 'KP14-02',
                    name: officialTitle ? '三角形全等的判定' : '全等形',
                    summary: '用于验证跨分块章节合并。',
                    pageStart: officialTitle ? 35 : 40,
                    pageEnd: officialTitle ? 39 : 45,
                    prerequisiteCodes: [],
                  },
                ],
              },
            ],
          },
          model: 'test-model',
          attempts: 1,
          usedFallback: false,
        }
      },
    } as unknown as ModelRouter
    const text = [
      `--- PAGE 35 ---\n${'全等三角形内容'.repeat(900)}`,
      `--- PAGE 40 ---\n${'全等判定内容'.repeat(900)}`,
    ].join('\n')

    const result = await new OpenAiCompatibleTextbookAnalyzer(router).analyze(
      familyId,
      'math.pdf',
      text,
    )

    expect(modelCalls).toBe(2)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]).toMatchObject({
      code: 'CH14',
      title: '第十四章 全等三角形',
      pageStart: 35,
      pageEnd: 45,
    })
    expect(
      result.chapters[0]?.knowledgePoints.map((item) => item.code),
    ).toEqual(['KP14-01', 'KP14-02'])
  })

  it('groups the thin-plate centroid practice into chapter thirteen', async () => {
    let modelCalls = 0
    const router = {
      isConfigured() {
        return true
      },
      async chatJson() {
        modelCalls += 1
        const isPractice = modelCalls === 2
        return {
          data: {
            ...draft(),
            chapters: [
              {
                code: isPractice ? 'PRACTICE-CENTROID' : 'CH13',
                title: isPractice
                  ? '综合与实践 确定匀质薄板的重心位置'
                  : '第十三章 三角形',
                pageStart: isPractice ? 29 : 1,
                pageEnd: isPractice ? 34 : 28,
                knowledgePoints: [
                  {
                    code: isPractice ? 'KP13-CENTROID' : 'KP13-TRIANGLE',
                    name: isPractice ? '确定薄板重心' : '三角形的概念',
                    summary: '用于验证综合实践的章节归属。',
                    pageStart: isPractice ? 29 : 2,
                    pageEnd: isPractice ? 36 : 4,
                    prerequisiteCodes: [],
                  },
                ],
              },
            ],
          },
          model: 'test-model',
          attempts: 1,
          usedFallback: false,
        }
      },
    } as unknown as ModelRouter
    const text = [
      `--- PAGE 1 ---\n${'三角形内容'.repeat(1_000)}`,
      `--- PAGE 29 ---\n${'薄板重心内容'.repeat(1_000)}`,
    ].join('\n')

    const result = await new OpenAiCompatibleTextbookAnalyzer(router).analyze(
      familyId,
      'math.pdf',
      text,
    )

    expect(modelCalls).toBe(2)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]).toMatchObject({
      code: 'CH13',
      title: '第十三章 三角形',
      pageStart: 1,
      pageEnd: 36,
    })
    expect(
      result.chapters[0]?.knowledgePoints.map((item) => item.code),
    ).toEqual(['KP13-TRIANGLE', 'KP13-CENTROID'])
  })

  it('groups the shortest-path practice into chapter fifteen', async () => {
    let modelCalls = 0
    const router = {
      isConfigured() {
        return true
      },
      async chatJson() {
        modelCalls += 1
        const isPractice = modelCalls === 2
        return {
          data: {
            ...draft(),
            chapters: [
              {
                code: isPractice ? 'PRACTICE' : 'CH15',
                title: isPractice ? '综合与实践' : '第十五章 轴对称',
                pageStart: isPractice ? 103 : 61,
                pageEnd: isPractice ? 103 : 102,
                knowledgePoints: [
                  {
                    code: isPractice ? 'KP-SHORTEST' : 'KP-SYMMETRY',
                    name: isPractice ? '最短路径问题建模' : '轴对称',
                    summary: isPractice
                      ? '利用轴对称解决最短路径问题。'
                      : '理解轴对称的定义与性质。',
                    pageStart: isPractice ? 103 : 62,
                    pageEnd: isPractice ? 103 : 64,
                    prerequisiteCodes: [],
                  },
                ],
              },
            ],
          },
          model: 'test-model',
          attempts: 1,
          usedFallback: false,
        }
      },
    } as unknown as ModelRouter
    const text = [
      `--- PAGE 61 ---\n${'轴对称内容'.repeat(1_000)}`,
      `--- PAGE 103 ---\n${'最短路径内容'.repeat(1_000)}`,
    ].join('\n')

    const result = await new OpenAiCompatibleTextbookAnalyzer(router).analyze(
      familyId,
      'math.pdf',
      text,
    )

    expect(modelCalls).toBe(2)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]).toMatchObject({
      code: 'CH15',
      title: '第十五章 轴对称',
      pageStart: 61,
      pageEnd: 103,
    })
    expect(
      result.chapters[0]?.knowledgePoints.map((item) => item.code),
    ).toEqual(['KP-SYMMETRY', 'KP-SHORTEST'])
  })

  it('splits timed-out textbook segments until smaller requests succeed', async () => {
    const attempts: Array<{
      characters: number
      maxRetries?: number
      timeoutMs?: number
    }> = []
    const successfulLengths: number[] = []
    const progressEvents: Array<{
      completedChunks: number
      totalChunks: number
    }> = []
    const router = {
      isConfigured() {
        return true
      },
      async chatJson(
        _familyId: string,
        request: {
          messages: Array<{ role: string; content: string }>
          maxRetries?: number
          timeoutMs?: number
        },
      ) {
        const payload = JSON.parse(request.messages[1]!.content) as {
          textbookText: string
        }
        attempts.push({
          characters: payload.textbookText.length,
          ...(request.maxRetries !== undefined
            ? { maxRetries: request.maxRetries }
            : {}),
          ...(request.timeoutMs !== undefined
            ? { timeoutMs: request.timeoutMs }
            : {}),
        })
        if (payload.textbookText.length > 2_000) {
          throw new DOMException('request timed out', 'TimeoutError')
        }
        successfulLengths.push(payload.textbookText.length)
        return {
          data: draft(),
          model: 'test-model',
          attempts: 1,
          usedFallback: false,
        }
      },
    } as ModelRouter
    const text = `--- PAGE 1 ---\n${'教材内容'.repeat(1_700)}`

    await new OpenAiCompatibleTextbookAnalyzer(router).analyze(
      familyId,
      'math.pdf',
      text,
      (progress) => progressEvents.push(progress),
    )

    expect(attempts[0]).toMatchObject({
      maxRetries: 0,
      timeoutMs: 45_000,
    })
    expect(
      attempts.every(
        (attempt) =>
          attempt.maxRetries === 0 && attempt.timeoutMs === 45_000,
      ),
    ).toBe(true)
    expect(attempts.some((attempt) => attempt.characters > 2_000)).toBe(true)
    expect(Math.max(...successfulLengths)).toBeLessThanOrEqual(2_000)
    expect(progressEvents[0]).toEqual({
      completedChunks: 0,
      totalChunks: 1,
    })
    expect(
      progressEvents.some((progress) => progress.totalChunks > 1),
    ).toBe(true)
    expect(progressEvents.at(-1)).toMatchObject({
      completedChunks: progressEvents.at(-1)?.totalChunks,
    })
  })

  it('does not split non-retryable textbook model errors', async () => {
    let attempts = 0
    const router = {
      isConfigured() {
        return true
      },
      async chatJson() {
        attempts += 1
        throw new SyntaxError('invalid JSON')
      },
    } as unknown as ModelRouter
    const text = `--- PAGE 1 ---\n${'教材内容'.repeat(1_700)}`

    await expect(
      new OpenAiCompatibleTextbookAnalyzer(router).analyze(
        familyId,
        'math.pdf',
        text,
      ),
    ).rejects.toThrow('invalid JSON')
    expect(attempts).toBe(1)
  })

  it('generates stable codes when the model omits non-semantic identifiers', async () => {
    const incomplete = structuredClone(draft()) as {
      chapters: Array<{
        code?: string
        title: string
        knowledgePoints: Array<{
          code?: string
          name: string
        }>
      }>
    }
    delete incomplete.chapters[0]!.code
    delete incomplete.chapters[0]!.knowledgePoints[0]!.code
    const router = {
      isConfigured() {
        return true
      },
      async chatJson() {
        return {
          data: incomplete,
          model: 'test-model',
          attempts: 1,
          usedFallback: false,
        }
      },
    } as unknown as ModelRouter
    const analyzer = new OpenAiCompatibleTextbookAnalyzer(router)

    const first = await analyzer.analyze(familyId, 'math.pdf', '教材正文')
    const second = await analyzer.analyze(familyId, 'math.pdf', '教材正文')

    expect(first.chapters[0]?.code).toMatch(/^CH-[A-F0-9]{12}$/)
    expect(first.chapters[0]?.knowledgePoints[0]?.code).toMatch(
      /^KP-[A-F0-9]{12}$/,
    )
    expect(second.chapters[0]?.code).toBe(first.chapters[0]?.code)
    expect(second.chapters[0]?.knowledgePoints[0]?.code).toBe(
      first.chapters[0]?.knowledgePoints[0]?.code,
    )
  })

  it('resumes a failed upload without reanalyzing completed chunks', async () => {
    const importRepository = new InMemoryTextbookImportRepository()
    const resumableExtractor: PdfTextExtractor = {
      async extract() {
        return {
          text: [
            `--- PAGE 1 ---\n${'第一部分'.repeat(1_200)}`,
            `--- PAGE 2 ---\n${'第二部分'.repeat(1_200)}`,
          ].join('\n'),
          pageCount: 2,
        }
      },
    }
    let modelCalls = 0
    let failSecondCall = true
    const router = {
      isConfigured() {
        return true
      },
      async chatJson() {
        modelCalls += 1
        if (failSecondCall && modelCalls === 2) {
          throw new SyntaxError('invalid JSON')
        }
        return {
          data: draft(),
          model: 'test-model',
          attempts: 1,
          usedFallback: false,
        }
      },
    } as unknown as ModelRouter
    const data = new TextEncoder().encode('%PDF-resumable-test')

    const firstService = new TextbookImportService(
      new InMemoryContentRepository(),
      resumableExtractor,
      new OpenAiCompatibleTextbookAnalyzer(router),
      importRepository,
    )
    await expect(
      firstService.upload(familyId, 'math.pdf', data),
    ).rejects.toThrow('invalid JSON')
    expect(modelCalls).toBe(2)

    failSecondCall = false
    const secondService = new TextbookImportService(
      new InMemoryContentRepository(),
      resumableExtractor,
      new OpenAiCompatibleTextbookAnalyzer(router),
      importRepository,
    )
    const resumed = await secondService.upload(familyId, 'math.pdf', data)

    expect(resumed.status).toBe('ready_for_review')
    expect(modelCalls).toBe(3)
    expect(secondService.getProgress(familyId)).toMatchObject({
      status: 'completed',
      completedChunks: 2,
      totalChunks: 2,
    })
  })
})
