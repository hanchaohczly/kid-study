import type { RequestContext } from '@kid-study/contracts'
import { z } from 'zod'
import type {
  ContentRepository,
  KnowledgePoint,
  QuestionPrivate,
  QuestionPublic,
} from '../content/content-repository.js'
import type { ModelRouter } from '../models/model-router.js'
import type {
  UpdateWrongItemInput,
  WrongBookRepository,
  WrongItem,
  WrongItemPhoto,
  WrongItemStatus,
} from './wrong-book-repository.js'

export interface WrongAnswerCollector {
  captureSystemWrong(input: {
    familyId: string
    kidId: string
    submissionId: string
    question: QuestionPublic
    privateQuestion: QuestionPrivate
    studentAnswer: string
    occurredAt: string
  }): Promise<void>
}

export interface PhotoWrongAnalyzer {
  isConfigured(familyId: string): boolean
  analyze(input: {
    familyId: string
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
    data: Buffer
    knowledgePoints: KnowledgePoint[]
  }): Promise<PhotoWrongAnalysis>
}

export interface PhotoWrongAnalysis {
  stem: string
  studentAnswer?: string
  answerKey: string
  analysis: string
  kpId: string
  mappingConfidence: number
}

export class WrongBookService implements WrongAnswerCollector {
  constructor(
    private readonly repository: WrongBookRepository,
    private readonly content: ContentRepository,
    private readonly photoAnalyzer: PhotoWrongAnalyzer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  isPhotoRecognitionConfigured(familyId: string): boolean {
    return this.photoAnalyzer.isConfigured(familyId)
  }

  async captureSystemWrong(input: {
    familyId: string
    kidId: string
    submissionId: string
    question: QuestionPublic
    privateQuestion: QuestionPrivate
    studentAnswer: string
    occurredAt: string
  }): Promise<void> {
    await this.repository.captureSystemWrong({
      familyId: input.familyId,
      kidId: input.kidId,
      submissionId: input.submissionId,
      questionId: input.question.id,
      kpId: input.question.kpId,
      stem: input.question.stem,
      studentAnswer: input.studentAnswer,
      answerKey: input.privateQuestion.answerKey,
      analysis: input.privateQuestion.referenceSteps.join('\n'),
      occurredAt: input.occurredAt,
    })
  }

  async createFromPhoto(
    context: RequestContext,
    input: {
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
      data: Buffer
    },
  ): Promise<WrongItem> {
    if (context.role !== 'parent') throw new Error('WRONG_ITEM_NOT_FOUND')
    if (!this.photoAnalyzer.isConfigured(context.familyId)) {
      throw new Error('VISION_NOT_CONFIGURED')
    }
    const knowledgePoints = (
      await this.content.listKnowledgePoints(context.familyId)
    ).filter((item) => item.status === 'published')
    if (!knowledgePoints.length) {
      throw new Error('NO_PUBLISHED_KNOWLEDGE_POINTS')
    }
    const analysis = await this.photoAnalyzer.analyze({
      familyId: context.familyId,
      mimeType: input.mimeType,
      data: input.data,
      knowledgePoints,
    })
    if (!knowledgePoints.some((item) => item.id === analysis.kpId)) {
      throw new Error('VISION_UNKNOWN_KNOWLEDGE_POINT')
    }
    const item = await this.repository.createPhotoWrong({
      familyId: context.familyId,
      kidId: this.kidId(context),
      kpId: analysis.kpId,
      stem: analysis.stem,
      ...(analysis.studentAnswer
        ? { studentAnswer: analysis.studentAnswer }
        : {}),
      answerKey: analysis.answerKey,
      analysis: analysis.analysis,
      photoMimeType: input.mimeType,
      photoData: input.data,
      mappingConfidence: analysis.mappingConfidence,
      occurredAt: this.clock().toISOString(),
    })
    return this.enrich(item, knowledgePoints)
  }

  async list(
    context: RequestContext,
    status?: WrongItemStatus,
  ): Promise<{
    photoRecognitionConfigured: boolean
    items: Array<Omit<WrongItem, 'answerKey' | 'analysis'> & {
      answerKey?: string
      analysis?: string
      photoUrl?: string
    }>
  }> {
    const [items, knowledgePoints] = await Promise.all([
      this.repository.list(context.familyId, this.kidId(context), status),
      this.content.listKnowledgePoints(context.familyId),
    ])
    return {
      photoRecognitionConfigured: this.photoAnalyzer.isConfigured(
        context.familyId,
      ),
      items: items.map((item) =>
        this.serialize(this.enrich(item, knowledgePoints), context.role),
      ),
    }
  }

  async getPhoto(
    context: RequestContext,
    id: string,
  ): Promise<WrongItemPhoto | undefined> {
    return this.repository.getPhoto(
      context.familyId,
      this.kidId(context),
      id,
    )
  }

  async update(
    context: RequestContext,
    id: string,
    input: UpdateWrongItemInput,
  ): Promise<WrongItem> {
    if (context.role !== 'parent') throw new Error('WRONG_ITEM_NOT_FOUND')
    const knowledgePoints = await this.content.listKnowledgePoints(
      context.familyId,
    )
    if (
      input.kpId &&
      !knowledgePoints.some(
        (item) => item.id === input.kpId && item.status === 'published',
      )
    ) {
      throw new Error('KNOWLEDGE_POINT_NOT_FOUND')
    }
    const normalized: UpdateWrongItemInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.kpId ? { kpId: input.kpId } : {}),
      ...(input.tags
        ? {
            tags: [
              ...new Set(
                input.tags.map((tag) => tag.trim()).filter(Boolean),
              ),
            ].slice(0, 10),
          }
        : {}),
      ...(input.note !== undefined ? { note: input.note.trim() } : {}),
    }
    const item = await this.repository.update(
      context.familyId,
      this.kidId(context),
      id,
      normalized,
    )
    if (!item) throw new Error('WRONG_ITEM_NOT_FOUND')
    return this.enrich(item, knowledgePoints)
  }

  async remove(context: RequestContext, id: string): Promise<void> {
    if (context.role !== 'parent') throw new Error('WRONG_ITEM_NOT_FOUND')
    const removed = await this.repository.remove(
      context.familyId,
      this.kidId(context),
      id,
    )
    if (!removed) throw new Error('WRONG_ITEM_NOT_FOUND')
  }

  async recordReview(
    context: RequestContext,
    id: string,
    result: 'correct' | 'incorrect',
  ): Promise<WrongItem> {
    const item = await this.repository.recordReview({
      familyId: context.familyId,
      kidId: this.kidId(context),
      wrongItemId: id,
      reviewedBy: context.userId,
      result,
      reviewedAt: this.clock().toISOString(),
    })
    if (!item) throw new Error('WRONG_ITEM_NOT_FOUND')
    const knowledgePoints = await this.content.listKnowledgePoints(
      context.familyId,
    )
    return this.enrich(item, knowledgePoints)
  }

  async close(): Promise<void> {
    await this.repository.close()
  }

  private enrich(
    item: WrongItem,
    knowledgePoints: KnowledgePoint[],
  ): WrongItem {
    const knowledgePoint = item.kpId
      ? knowledgePoints.find((candidate) => candidate.id === item.kpId)
      : undefined
    return {
      ...item,
      ...(knowledgePoint
        ? {
            knowledgePointName: knowledgePoint.name,
            chapter: knowledgePoint.chapter,
          }
        : {}),
    }
  }

  private serialize(item: WrongItem, role: RequestContext['role']) {
    const photoUrl = item.hasPhoto
      ? `/api/v1/wrong-items/${item.id}/photo`
      : undefined
    if (role === 'parent') {
      return {
        ...item,
        ...(photoUrl ? { photoUrl } : {}),
      }
    }
    const { answerKey: _, analysis: __, ...safe } = item
    return {
      ...safe,
      ...(photoUrl ? { photoUrl } : {}),
    }
  }

  private kidId(context: RequestContext): string {
    return context.kidId ?? context.userId
  }
}

const photoWrongSchema = z.object({
  stem: z.string().trim().min(2).max(5_000),
  studentAnswer: z.string().trim().max(2_000).optional(),
  answerKey: z.string().trim().min(1).max(2_000),
  analysis: z.string().trim().min(1).max(5_000),
  kpId: z.uuid(),
  mappingConfidence: z.number().min(0).max(1),
})

export class OpenAiCompatiblePhotoWrongAnalyzer
  implements PhotoWrongAnalyzer
{
  constructor(private readonly router: ModelRouter) {}

  isConfigured(familyId: string): boolean {
    return this.router.isConfigured(familyId, 'vision')
  }

  async analyze(input: {
    familyId: string
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
    data: Buffer
    knowledgePoints: KnowledgePoint[]
  }): Promise<PhotoWrongAnalysis> {
    const result = await this.router.visionJson<unknown>(input.familyId, {
      prompt: [
        '你是初中数学错题识别器。识别图片中的一道错题，并映射到给定教材知识点。',
        '只输出 JSON，不要 Markdown。',
        'stem 保留完整题干、条件和选项；studentAnswer 仅在图片中能明确看到学生答案时填写。',
        'answerKey 给出正确答案；analysis 给出供家长查看的简要错误原因和关键解法。',
        'kpId 必须从 knowledgePoints 的 id 中选择最匹配的一项，mappingConfidence 为 0 到 1。',
        JSON.stringify({
          outputSchema: {
            stem: 'string',
            studentAnswer: 'string，可选',
            answerKey: 'string',
            analysis: 'string',
            kpId: 'uuid',
            mappingConfidence: 'number 0..1',
          },
          knowledgePoints: input.knowledgePoints.map((item) => ({
            id: item.id,
            code: item.code,
            name: item.name,
            chapter: item.chapter,
            summary: item.summary.slice(0, 240),
          })),
        }),
      ].join('\n'),
      images: [
        {
          mimeType: input.mimeType,
          base64: input.data.toString('base64'),
        },
      ],
    })
    const root = asRecord(result.data)
    const candidate =
      asRecord(root?.data) ??
      asRecord(root?.result) ??
      asRecord(root?.wrongItem) ??
      root
    const parsed = photoWrongSchema.parse(candidate)
    return {
      stem: parsed.stem,
      ...(parsed.studentAnswer
        ? { studentAnswer: parsed.studentAnswer }
        : {}),
      answerKey: parsed.answerKey,
      analysis: parsed.analysis,
      kpId: parsed.kpId,
      mappingConfidence: parsed.mappingConfidence,
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
