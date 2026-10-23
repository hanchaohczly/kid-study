import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { PDFParse } from 'pdf-parse'
import { z } from 'zod'
import type { ContentRepository } from '../content/content-repository.js'
import type { ModelRouter } from '../models/model-router.js'

const require = createRequire(import.meta.url)
const cMapUrl = `${join(
  dirname(require.resolve('pdfjs-dist/package.json')),
  'cmaps',
)}/`
const initialChunkCharacters = 8_000
const minimumChunkCharacters = 2_000
const adaptiveChunkTimeoutMs = 45_000
const textbookAnalysisVersion = 'textbook-structure-v1'

export const textbookDraftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  subject: z.literal('数学'),
  grade: z.string().trim().min(1).max(40),
  edition: z.string().trim().min(1).max(80),
  chapters: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(40),
        title: z.string().trim().min(1).max(120),
        pageStart: z.number().int().positive(),
        pageEnd: z.number().int().positive(),
        knowledgePoints: z.array(
          z
            .object({
              code: z.string().trim().min(1).max(40),
              name: z.string().trim().min(1).max(80),
              summary: z.string().trim().min(1).max(1_000),
              pageStart: z.number().int().positive(),
              pageEnd: z.number().int().positive(),
              prerequisiteCodes: z
                .array(z.string().trim().min(1).max(40))
                .max(10),
            })
            .strict(),
        ),
      }),
    )
    .min(1)
    .max(30),
})

export type TextbookDraft = z.infer<typeof textbookDraftSchema>

export interface TextbookImport {
  id: string
  familyId: string
  fileName: string
  pageCount: number
  extractedCharacters: number
  status: 'ready_for_review' | 'confirmed'
  draft: TextbookDraft
  createdAt: string
  confirmedAt?: string
}

export interface PdfText {
  text: string
  pageCount: number
}

export interface PdfTextExtractor {
  extract(data: Uint8Array): Promise<PdfText>
}

export interface TextbookAnalyzer {
  isConfigured(familyId: string): boolean
  analyze(
    familyId: string,
    fileName: string,
    text: string,
    onProgress?: (progress: TextbookChunkProgress) => void,
    checkpoint?: TextbookAnalysisCheckpoint,
  ): Promise<TextbookDraft>
}

export interface TextbookAnalysisCheckpoint {
  get(path: string): Promise<TextbookAnalysisSegment | undefined>
  saveCompleted(path: string, draft: TextbookDraft): Promise<void>
  saveSplit(path: string): Promise<void>
}

export interface TextbookAnalysisSegment {
  jobId: string
  path: string
  status: 'completed' | 'split'
  draft?: TextbookDraft
  createdAt: string
  updatedAt: string
}

export interface TextbookAnalysisJob {
  id: string
  familyId: string
  fileHash: string
  analysisVersion: string
  fileName: string
  pageCount: number
  extractedCharacters: number
  status: 'analyzing' | 'failed' | 'completed'
  importId?: string
  errorCode?: string
  createdAt: string
  updatedAt: string
}

export interface TextbookChunkProgress {
  completedChunks: number
  totalChunks: number
}

export interface TextbookAnalysisProgress {
  jobId: string
  fileName: string
  status: 'extracting' | 'analyzing' | 'saving' | 'completed' | 'failed'
  percent: number
  message: string
  completedChunks: number
  totalChunks: number
  startedAt: string
  updatedAt: string
}

export interface TextbookImportRepository {
  save(item: TextbookImport): Promise<void>
  get(familyId: string, id: string): Promise<TextbookImport | undefined>
  list(familyId: string): Promise<TextbookImport[]>
  findAnalysisJob(
    familyId: string,
    fileHash: string,
    analysisVersion: string,
  ): Promise<TextbookAnalysisJob | undefined>
  saveAnalysisJob(job: TextbookAnalysisJob): Promise<void>
  getAnalysisSegment(
    jobId: string,
    path: string,
  ): Promise<TextbookAnalysisSegment | undefined>
  saveAnalysisSegment(segment: TextbookAnalysisSegment): Promise<void>
  close(): Promise<void>
}

export class InMemoryTextbookImportRepository
  implements TextbookImportRepository
{
  private readonly imports = new Map<string, TextbookImport>()
  private readonly analysisJobs = new Map<string, TextbookAnalysisJob>()
  private readonly analysisSegments = new Map<string, TextbookAnalysisSegment>()

  async save(item: TextbookImport): Promise<void> {
    this.imports.set(item.id, structuredClone(item))
  }

  async get(
    familyId: string,
    id: string,
  ): Promise<TextbookImport | undefined> {
    const item = this.imports.get(id)
    return item?.familyId === familyId ? structuredClone(item) : undefined
  }

  async list(familyId: string): Promise<TextbookImport[]> {
    return [...this.imports.values()]
      .filter((item) => item.familyId === familyId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((item) => structuredClone(item))
  }

  async findAnalysisJob(
    familyId: string,
    fileHash: string,
    analysisVersion: string,
  ): Promise<TextbookAnalysisJob | undefined> {
    const job = [...this.analysisJobs.values()].find(
      (item) =>
        item.familyId === familyId &&
        item.fileHash === fileHash &&
        item.analysisVersion === analysisVersion,
    )
    return job ? structuredClone(job) : undefined
  }

  async saveAnalysisJob(job: TextbookAnalysisJob): Promise<void> {
    this.analysisJobs.set(job.id, structuredClone(job))
  }

  async getAnalysisSegment(
    jobId: string,
    path: string,
  ): Promise<TextbookAnalysisSegment | undefined> {
    const segment = this.analysisSegments.get(`${jobId}:${path}`)
    return segment ? structuredClone(segment) : undefined
  }

  async saveAnalysisSegment(
    segment: TextbookAnalysisSegment,
  ): Promise<void> {
    this.analysisSegments.set(
      `${segment.jobId}:${segment.path}`,
      structuredClone(segment),
    )
  }

  async close(): Promise<void> {}
}

export class PdfParseTextExtractor implements PdfTextExtractor {
  async extract(data: Uint8Array): Promise<PdfText> {
    const parser = new PDFParse({ data, cMapUrl, cMapPacked: true })
    try {
      const result = await parser.getText()
      return {
        text: result.pages
          .map((page) => `--- PAGE ${page.num} ---\n${page.text}`)
          .join('\n'),
        pageCount: result.total,
      }
    } finally {
      await parser.destroy()
    }
  }
}

export class OpenAiCompatibleTextbookAnalyzer implements TextbookAnalyzer {
  constructor(private readonly router: ModelRouter) {}

  isConfigured(familyId: string): boolean {
    return this.router.isConfigured(familyId, 'chat')
  }

  async analyze(
    familyId: string,
    fileName: string,
    text: string,
    onProgress?: (progress: TextbookChunkProgress) => void,
    checkpoint?: TextbookAnalysisCheckpoint,
  ): Promise<TextbookDraft> {
    const chunks = splitText(text, initialChunkCharacters)
    const partials: TextbookDraft[] = []
    const progress = {
      completedChunks: 0,
      totalChunks: chunks.length,
    }
    onProgress?.({ ...progress })
    // #region debug-point C:adaptive-analysis-start
    if (process.env.NODE_ENV !== 'test') {
      void fetch('http://127.0.0.1:7777/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'textbook-analysis-unavailable',
          runId: 'post-fix-adaptive',
          hypothesisId: 'C',
          location: 'textbook-import-service.ts:analyze',
          msg: '[DEBUG] adaptive textbook analysis started',
          data: {
            characters: text.length,
            initialChunks: chunks.length,
            initialChunkCharacters,
            minimumChunkCharacters,
          },
          ts: Date.now(),
        }),
      }).catch(() => {})
    }
    // #endregion
    for (const [index, chunk] of chunks.entries()) {
      partials.push(
        ...(await this.analyzeChunkWithAdaptiveSplit(
          familyId,
          fileName,
          chunk,
          {
            chunkNumber: index + 1,
            chunkCount: chunks.length,
            path: `${index + 1}`,
            depth: 0,
          },
          progress,
          onProgress,
          checkpoint,
        )),
      )
    }
    return mergeDrafts(partials)
  }

  private async analyzeChunkWithAdaptiveSplit(
    familyId: string,
    fileName: string,
    text: string,
    segment: {
      chunkNumber: number
      chunkCount: number
      path: string
      depth: number
    },
    progress: TextbookChunkProgress,
    onProgress?: (progress: TextbookChunkProgress) => void,
    checkpoint?: TextbookAnalysisCheckpoint,
  ): Promise<TextbookDraft[]> {
    const saved = await checkpoint?.get(segment.path)
    if (saved?.status === 'completed' && saved.draft) {
      progress.completedChunks += 1
      onProgress?.({ ...progress })
      return [saved.draft]
    }
    if (saved?.status === 'split') {
      return this.analyzeSplitChildren(
        familyId,
        fileName,
        text,
        segment,
        progress,
        onProgress,
        checkpoint,
      )
    }

    const startedAt = Date.now()
    try {
      const draft = await this.analyzeChunk(
        familyId,
        fileName,
        text,
        segment.chunkNumber,
        segment.chunkCount,
        segment.path,
      )
      // #region debug-point C:adaptive-segment-success
      if (process.env.NODE_ENV !== 'test') {
        void fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'textbook-analysis-unavailable',
            runId: 'post-fix-adaptive',
            hypothesisId: 'C',
            location:
              'textbook-import-service.ts:analyzeChunkWithAdaptiveSplit',
            msg: '[DEBUG] textbook segment completed',
            data: {
              path: segment.path,
              depth: segment.depth,
              characters: text.length,
              durationMs: Date.now() - startedAt,
            },
            ts: Date.now(),
          }),
        }).catch(() => {})
      }
      // #endregion
      await checkpoint?.saveCompleted(segment.path, draft)
      progress.completedChunks += 1
      onProgress?.({ ...progress })
      return [draft]
    } catch (error) {
      const canSplit =
        text.length > minimumChunkCharacters && isAdaptiveSplitError(error)
      // #region debug-point C:adaptive-segment-failure
      if (process.env.NODE_ENV !== 'test') {
        void fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'textbook-analysis-unavailable',
            runId: 'post-fix-adaptive',
            hypothesisId: 'C',
            location:
              'textbook-import-service.ts:analyzeChunkWithAdaptiveSplit',
            msg: canSplit
              ? '[DEBUG] textbook segment timed out; splitting'
              : '[DEBUG] textbook segment failed',
            data: {
              path: segment.path,
              depth: segment.depth,
              characters: text.length,
              durationMs: Date.now() - startedAt,
              errorName: error instanceof Error ? error.name : 'UnknownError',
              errorMessage:
                error instanceof Error ? error.message : String(error),
            },
            ts: Date.now(),
          }),
        }).catch(() => {})
      }
      // #endregion
      if (!canSplit) throw error

      await checkpoint?.saveSplit(segment.path)
      return this.analyzeSplitChildren(
        familyId,
        fileName,
        text,
        segment,
        progress,
        onProgress,
        checkpoint,
      )
    }
  }

  private async analyzeSplitChildren(
    familyId: string,
    fileName: string,
    text: string,
    segment: {
      chunkNumber: number
      chunkCount: number
      path: string
      depth: number
    },
    progress: TextbookChunkProgress,
    onProgress?: (progress: TextbookChunkProgress) => void,
    checkpoint?: TextbookAnalysisCheckpoint,
  ): Promise<TextbookDraft[]> {
    const targetSize = Math.max(
      minimumChunkCharacters,
      Math.ceil(text.length / 2),
    )
    const children = splitText(text, targetSize)
    if (children.length < 2) {
      throw new Error('INVALID_TEXTBOOK_SPLIT_CHECKPOINT')
    }
    progress.totalChunks += children.length - 1
    onProgress?.({ ...progress })
    const drafts: TextbookDraft[] = []
    for (const [index, child] of children.entries()) {
      drafts.push(
        ...(await this.analyzeChunkWithAdaptiveSplit(
          familyId,
          fileName,
          child,
          {
            ...segment,
            path: `${segment.path}.${index + 1}`,
            depth: segment.depth + 1,
          },
          progress,
          onProgress,
          checkpoint,
        )),
      )
    }
    return drafts
  }

  private async analyzeChunk(
    familyId: string,
    fileName: string,
    text: string,
    chunkNumber: number,
    chunkCount: number,
    segmentPath: string,
  ): Promise<TextbookDraft> {
    const result = await this.router.chatJson<unknown>(familyId, {
      temperature: 0.1,
      maxRetries: 0,
      timeoutMs: adaptiveChunkTimeoutMs,
      messages: [
          {
            role: 'system',
            content: [
              '你是初中数学教材结构化专家。',
              '只依据提供的教材文本提取内容，不补充教材外事实。',
              '输出严格 JSON，不使用 Markdown。',
              '知识点粒度应可独立教学与检测，code 在本教材内稳定且唯一。',
              'prerequisiteCodes 只能引用本次输出的知识点 code。',
              '这里只梳理教材知识结构，不生成任何题目。',
              '章节标题应优先保留教材中的正式章号和完整名称，例如“第十四章 全等三角形”。',
              '“综合与实践 确定匀质薄板的重心位置”归入“第十三章 三角形”，不要单独建立章节。',
              '“综合与实践 最短路径问题”归入“第十五章 轴对称”，不要单独建立章节。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: '提取教材章节、知识点和前置关系',
              fileName,
              segment: { chunkNumber, chunkCount },
              outputSchema: {
                title: '教材名',
                subject: '数学',
                grade: '年级',
                edition: '版本',
                chapters: [
                  {
                    code: '章节编码',
                    title: '章节名',
                    pageStart: 1,
                    pageEnd: 10,
                    knowledgePoints: [
                      {
                        code: '稳定知识点编码',
                        name: '知识点名',
                        summary: '教材内定义与学习目标',
                        pageStart: 1,
                        pageEnd: 2,
                        prerequisiteCodes: [],
                      },
                    ],
                  },
                ],
              },
              textbookText: text,
            }),
          },
        ],
    })
    return textbookDraftSchema.parse(
      withStableGeneratedCodes(result.data, segmentPath),
    )
  }
}

function withStableGeneratedCodes(
  value: unknown,
  segmentPath: string,
): unknown {
  if (!value || typeof value !== 'object') return value
  const normalized = structuredClone(value) as {
    chapters?: Array<{
      code?: unknown
      title?: unknown
      knowledgePoints?: Array<{
        code?: unknown
        name?: unknown
      }>
    }>
  }
  if (!Array.isArray(normalized.chapters)) return normalized

  for (const [chapterIndex, chapter] of normalized.chapters.entries()) {
    if (typeof chapter.code !== 'string' || !chapter.code.trim()) {
      const identity =
        typeof chapter.title === 'string' && chapter.title.trim()
          ? chapter.title.trim()
          : `${segmentPath}:${chapterIndex + 1}`
      chapter.code = generatedCode('CH', identity)
    }
    for (const [knowledgePointIndex, knowledgePoint] of (
      chapter.knowledgePoints ?? []
    ).entries()) {
      if (
        typeof knowledgePoint.code !== 'string' ||
        !knowledgePoint.code.trim()
      ) {
        const chapterIdentity =
          typeof chapter.title === 'string' ? chapter.title : chapter.code
        const knowledgePointIdentity =
          typeof knowledgePoint.name === 'string' &&
          knowledgePoint.name.trim()
            ? knowledgePoint.name.trim()
            : `${segmentPath}:${knowledgePointIndex + 1}`
        knowledgePoint.code = generatedCode(
          'KP',
          `${chapterIdentity}|${knowledgePointIdentity}`,
        )
      }
    }
  }
  return normalized
}

function generatedCode(prefix: 'CH' | 'KP', identity: string): string {
  return `${prefix}-${createHash('sha256')
    .update(identity)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase()}`
}

function isAdaptiveSplitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true
  const match = /^LLM_REQUEST_FAILED:(\d+)$/.exec(error.message)
  if (!match) return false
  const status = Number(match[1])
  return status === 408 || status >= 500
}

function splitText(text: string, maxCharacters: number): string[] {
  if (text.length <= maxCharacters) return [text]
  const pages = text.split(/(?=--- PAGE \d+ ---)/)
  const chunks: string[] = []
  let current = ''
  for (const page of pages) {
    if (current && current.length + page.length > maxCharacters) {
      chunks.push(current)
      current = ''
    }
    if (page.length > maxCharacters) {
      for (let offset = 0; offset < page.length; offset += maxCharacters) {
        if (current) {
          chunks.push(current)
          current = ''
        }
        chunks.push(page.slice(offset, offset + maxCharacters))
      }
    } else {
      current += page
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function mergeDrafts(drafts: TextbookDraft[]): TextbookDraft {
  const first = drafts[0]
  if (!first) throw new Error('LLM_EMPTY_RESPONSE')
  const chapterMap = new Map<string, TextbookDraft['chapters'][number]>()

  for (const draft of drafts) {
    for (const chapter of draft.chapters) {
      const normalized = normalizedChapterForGrouping(chapter)
      const key =
        normalizedChapterIdentity(normalized.title) ||
        normalizedTextIdentity(normalized.code)
      const existing = chapterMap.get(key)
      if (!existing) {
        normalized.title = normalizedChapterDisplayTitle(normalized.title)
        chapterMap.set(key, normalized)
        continue
      }
      if (
        chapterPresentationScore(normalized) >
        chapterPresentationScore(existing)
      ) {
        existing.code = normalized.code
        existing.title = normalizedChapterDisplayTitle(normalized.title)
      }
      existing.pageStart = Math.min(existing.pageStart, normalized.pageStart)
      existing.pageEnd = Math.max(existing.pageEnd, normalized.pageEnd)
      const kpCodes = new Set(existing.knowledgePoints.map((kp) => kp.code))
      existing.knowledgePoints.push(
        ...normalized.knowledgePoints
          .filter((kp) => !kpCodes.has(kp.code))
          .map((kp) => structuredClone(kp)),
      )
    }
  }

  const chapters = [...chapterMap.values()]
  for (const chapter of chapters) {
    chapter.knowledgePoints.sort(compareDraftKnowledgePointsByPage)
    if (chapter.knowledgePoints.length) {
      chapter.pageStart = Math.min(
        chapter.pageStart,
        ...chapter.knowledgePoints.map(
          (knowledgePoint) => knowledgePoint.pageStart,
        ),
      )
      chapter.pageEnd = Math.max(
        chapter.pageEnd,
        ...chapter.knowledgePoints.map(
          (knowledgePoint) => knowledgePoint.pageEnd,
        ),
      )
    }
  }

  return textbookDraftSchema.parse({
    ...first,
    chapters: chapters.sort(
      (left, right) =>
        compareChapterOrder(left.title, right.title) ||
        left.pageStart - right.pageStart ||
        left.code.localeCompare(right.code, 'zh-CN', { numeric: true }),
    ),
  })
}

function normalizedChapterForGrouping(
  chapter: TextbookDraft['chapters'][number],
): TextbookDraft['chapters'][number] {
  const normalized = structuredClone(chapter)
  if (isThinPlateCentroidPractice(normalized.title)) {
    normalized.code = 'CH13'
    normalized.title = '第十三章 三角形'
  } else if (isShortestPathPractice(normalized)) {
    normalized.code = 'CH15'
    normalized.title = '第十五章 轴对称'
  }
  return normalized
}

function isThinPlateCentroidPractice(title: string): boolean {
  const normalized = normalizedTextIdentity(title)
  return (
    normalized.includes('确定') &&
    normalized.includes('薄板') &&
    normalized.includes('重心位置')
  )
}

function isShortestPathPractice(
  chapter: TextbookDraft['chapters'][number],
): boolean {
  const normalizedTitle = normalizedTextIdentity(chapter.title)
  if (normalizedTitle.includes('最短路径')) return true
  if (normalizedTitle !== '综合与实践') return false
  return chapter.knowledgePoints.some((knowledgePoint) =>
    normalizedTextIdentity(
      `${knowledgePoint.name}${knowledgePoint.summary}`,
    ).includes('最短路径'),
  )
}

function compareDraftKnowledgePointsByPage(
  left: TextbookDraft['chapters'][number]['knowledgePoints'][number],
  right: TextbookDraft['chapters'][number]['knowledgePoints'][number],
): number {
  return (
    left.pageStart - right.pageStart ||
    left.pageEnd - right.pageEnd ||
    left.code.localeCompare(right.code, 'zh-CN', { numeric: true }) ||
    left.name.localeCompare(right.name, 'zh-CN')
  )
}

const chapterPrefixPattern =
  /^第\s*(?:\d+|[〇零一二三四五六七八九十百]+)\s*章\s*[-—–:：·、]?\s*/u

function normalizedChapterIdentity(title: string): string {
  return normalizedTextIdentity(title.replace(chapterPrefixPattern, ''))
}

function normalizedTextIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\-—–:：·、，,。()（）]/gu, '')
}

function normalizedChapterDisplayTitle(title: string): string {
  const trimmed = title.trim()
  const match = trimmed.match(
    /^(第\s*(?:\d+|[〇零一二三四五六七八九十百]+)\s*章)\s*[-—–:：·、]?\s*(.+)$/u,
  )
  if (!match) return trimmed
  return `${match[1]!.replace(/\s+/g, '')} ${match[2]!.trim()}`
}

function chapterPresentationScore(
  chapter: TextbookDraft['chapters'][number],
): number {
  const hasOfficialTitle = chapterPrefixPattern.test(chapter.title)
  const hasMeaningfulCode = !/^(?:章节编码|chapter)$/i.test(chapter.code.trim())
  return (
    (hasOfficialTitle ? 100 : 0) +
    (hasMeaningfulCode ? 10 : 0) +
    Math.min(chapter.title.length, 9)
  )
}

function compareChapterOrder(left: string, right: string): number {
  const leftNumber = chapterNumber(left)
  const rightNumber = chapterNumber(right)
  return leftNumber !== undefined && rightNumber !== undefined
    ? leftNumber - rightNumber
    : 0
}

function chapterNumber(title: string): number | undefined {
  const value = title.match(
    /^第\s*(\d+|[〇零一二三四五六七八九十百]+)\s*章/u,
  )?.[1]
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value)

  const digits: Record<string, number> = {
    〇: 0,
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (value === '十') return 10
  const [tens, ones] = value.split('十')
  if (value.includes('十')) {
    const tensValue = tens ? digits[tens] : 1
    const onesValue = ones ? digits[ones] : 0
    return tensValue === undefined || onesValue === undefined
      ? undefined
      : tensValue * 10 + onesValue
  }
  return digits[value]
}

export class TextbookImportService {
  private readonly progressByFamily = new Map<
    string,
    TextbookAnalysisProgress
  >()

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly extractor: PdfTextExtractor,
    private readonly analyzer: TextbookAnalyzer | undefined,
    private readonly importRepository: TextbookImportRepository =
      new InMemoryTextbookImportRepository(),
  ) {}

  isConfigured(familyId: string): boolean {
    return Boolean(this.analyzer?.isConfigured(familyId))
  }

  async upload(
    familyId: string,
    fileName: string,
    data: Uint8Array,
  ): Promise<TextbookImport> {
    if (!this.analyzer?.isConfigured(familyId)) {
      throw new Error('LLM_NOT_CONFIGURED')
    }
    if (
      data.length < 5 ||
      String.fromCharCode(...data.slice(0, 5)) !== '%PDF-'
    ) {
      throw new Error('INVALID_PDF')
    }

    const active = this.progressByFamily.get(familyId)
    if (active && isActiveProgress(active)) {
      throw new Error('TEXTBOOK_IMPORT_IN_PROGRESS')
    }

    const now = new Date().toISOString()
    const jobId = randomUUID()
    const fileHash = createHash('sha256').update(data).digest('hex')
    let analysisJob: TextbookAnalysisJob | undefined
    this.setProgress(familyId, {
      jobId,
      fileName,
      status: 'extracting',
      percent: 5,
      message: '正在读取 PDF 文本',
      completedChunks: 0,
      totalChunks: 0,
      startedAt: now,
      updatedAt: now,
    })

    try {
      const extracted = await this.extractor.extract(data)
      const normalizedText = extracted.text.replace(/\s+/g, ' ').trim()
      if (normalizedText.length < 500) {
        throw new Error('PDF_TEXT_LAYER_REQUIRED')
      }

      const existingJob = await this.importRepository.findAnalysisJob(
        familyId,
        fileHash,
        textbookAnalysisVersion,
      )
      if (existingJob?.status === 'completed') {
        const completedImport = await this.importRepository.get(
          familyId,
          existingJob.importId ?? existingJob.id,
        )
        if (completedImport) {
          this.setProgress(familyId, {
            jobId: existingJob.id,
            fileName,
            status: 'completed',
            percent: 100,
            message: '教材分析完成',
            completedChunks: 0,
            totalChunks: 0,
            startedAt: existingJob.createdAt,
            updatedAt: new Date().toISOString(),
          })
          return completedImport
        }
      }

      analysisJob = {
        id: existingJob?.id ?? jobId,
        familyId,
        fileHash,
        analysisVersion: textbookAnalysisVersion,
        fileName,
        pageCount: extracted.pageCount,
        extractedCharacters: normalizedText.length,
        status: 'analyzing',
        createdAt: existingJob?.createdAt ?? now,
        updatedAt: new Date().toISOString(),
      }
      await this.importRepository.saveAnalysisJob(analysisJob)
      this.setProgress(familyId, {
        jobId: analysisJob.id,
        fileName,
        status: 'analyzing',
        percent: 15,
        message: '正在准备教材分块',
        completedChunks: 0,
        totalChunks: 0,
        startedAt: analysisJob.createdAt,
        updatedAt: analysisJob.updatedAt,
      })
      this.updateProgress(familyId, {
        status: 'analyzing',
        percent: 15,
        message: '正在准备教材分块',
      })
      const checkpoint = this.createCheckpoint(analysisJob.id)
      const draft = await this.analyzer.analyze(
        familyId,
        fileName,
        extracted.text,
        ({ completedChunks, totalChunks }) => {
          const percent =
            totalChunks > 0
              ? 15 + Math.floor((completedChunks / totalChunks) * 75)
              : 15
          const displayedPercent = Math.max(
            this.progressByFamily.get(familyId)?.percent ?? 15,
            Math.min(percent, 90),
          )
          this.updateProgress(familyId, {
            status: 'analyzing',
            percent: displayedPercent,
            message:
              completedChunks < totalChunks
                ? `正在分析第 ${completedChunks + 1}/${totalChunks} 个分块`
                : `已完成 ${totalChunks}/${totalChunks} 个分块`,
            completedChunks,
            totalChunks,
          })
        },
        checkpoint,
      )
      this.updateProgress(familyId, {
        status: 'saving',
        percent: 95,
        message: '正在保存知识结构',
      })
      const item: TextbookImport = {
        id: analysisJob.id,
        familyId,
        fileName,
        pageCount: extracted.pageCount,
        extractedCharacters: normalizedText.length,
        status: 'ready_for_review',
        draft,
        createdAt: analysisJob.createdAt,
      }
      await this.importRepository.save(item)
      analysisJob = {
        ...analysisJob,
        status: 'completed',
        importId: item.id,
        updatedAt: new Date().toISOString(),
      }
      await this.importRepository.saveAnalysisJob(analysisJob)
      this.updateProgress(familyId, {
        status: 'completed',
        percent: 100,
        message: '教材分析完成',
      })
      return item
    } catch (error) {
      if (analysisJob) {
        await this.importRepository.saveAnalysisJob({
          ...analysisJob,
          status: 'failed',
          errorCode: analysisErrorCode(error),
          updatedAt: new Date().toISOString(),
        })
      }
      this.updateProgress(familyId, {
        status: 'failed',
        message: '教材分析失败，请查看错误提示',
      })
      throw error
    }
  }

  getProgress(familyId: string): TextbookAnalysisProgress | undefined {
    const progress = this.progressByFamily.get(familyId)
    return progress ? structuredClone(progress) : undefined
  }

  get(familyId: string, id: string): Promise<TextbookImport | undefined> {
    return this.importRepository.get(familyId, id)
  }

  list(familyId: string): Promise<TextbookImport[]> {
    return this.importRepository.list(familyId)
  }

  async confirm(familyId: string, id: string): Promise<TextbookImport> {
    const item = await this.get(familyId, id)
    if (!item) throw new Error('TEXTBOOK_IMPORT_NOT_FOUND')
    if (item.status === 'confirmed') return item

    const existingKnowledgePoints =
      await this.contentRepository.listKnowledgePoints(familyId)
    const kpByCode = new Map(
      existingKnowledgePoints.map((knowledgePoint) => [
        knowledgePoint.code,
        knowledgePoint,
      ]),
    )
    for (const chapter of item.draft.chapters) {
      for (const knowledgePoint of chapter.knowledgePoints) {
        let stored = kpByCode.get(knowledgePoint.code)
        if (!stored) {
          stored = await this.contentRepository.createKnowledgePoint(familyId, {
            code: knowledgePoint.code,
            name: knowledgePoint.name,
            chapter: chapter.title,
            summary: knowledgePoint.summary,
            sourcePageStart: knowledgePoint.pageStart,
            sourcePageEnd: knowledgePoint.pageEnd,
            prerequisiteCodes: knowledgePoint.prerequisiteCodes,
            status: 'published',
          })
          kpByCode.set(stored.code, stored)
        }
      }
    }

    item.status = 'confirmed'
    item.confirmedAt = new Date().toISOString()
    await this.importRepository.save(item)
    return item
  }

  async close(): Promise<void> {
    await this.importRepository.close()
  }

  private createCheckpoint(jobId: string): TextbookAnalysisCheckpoint {
    return {
      get: (path) => this.importRepository.getAnalysisSegment(jobId, path),
      saveCompleted: async (path, draft) => {
        const existing = await this.importRepository.getAnalysisSegment(
          jobId,
          path,
        )
        const now = new Date().toISOString()
        await this.importRepository.saveAnalysisSegment({
          jobId,
          path,
          status: 'completed',
          draft,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
      },
      saveSplit: async (path) => {
        const existing = await this.importRepository.getAnalysisSegment(
          jobId,
          path,
        )
        const now = new Date().toISOString()
        await this.importRepository.saveAnalysisSegment({
          jobId,
          path,
          status: 'split',
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
      },
    }
  }

  private setProgress(
    familyId: string,
    progress: TextbookAnalysisProgress,
  ): void {
    this.progressByFamily.set(familyId, progress)
  }

  private updateProgress(
    familyId: string,
    update: Partial<
      Omit<TextbookAnalysisProgress, 'jobId' | 'fileName' | 'startedAt'>
    >,
  ): void {
    const current = this.progressByFamily.get(familyId)
    if (!current) return
    this.progressByFamily.set(familyId, {
      ...current,
      ...update,
      updatedAt: new Date().toISOString(),
    })
  }
}

function isActiveProgress(progress: TextbookAnalysisProgress): boolean {
  return (
    progress.status === 'extracting' ||
    progress.status === 'analyzing' ||
    progress.status === 'saving'
  )
}

function analysisErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.slice(0, 160)
}
