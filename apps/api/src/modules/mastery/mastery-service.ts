import { createHash } from 'node:crypto'
import type { RequestContext } from '@kid-study/contracts'
import type {
  ContentRepository,
  KnowledgePoint,
} from '../content/content-repository.js'
import type {
  AnswerEvidence,
  TrainingStateRepository,
} from '../training/training-state-repository.js'
import type {
  MasteryCalculationDetails,
  MasteryProjection,
  MasteryRepository,
  MasteryReview,
  MasteryStatus,
  ReviewDecision,
  SaveProjectionInput,
} from './mastery-repository.js'

const modelVersion = 'm1-v2-four-dimensions'
const baselineDurationMs = 5 * 60 * 1_000

export interface MasteryListItem {
  projectionId: string
  projectionVersion: number
  modelVersion: string
  kpId: string
  knowledgePointName: string
  chapter: string
  status: MasteryStatus
  score: number | null
  sampleCount: number
  independentCount: number
  independentCorrectCount: number
  spacedDayCount: number
  evidenceFrom: string
  evidenceTo: string
  calculationDetails: MasteryCalculationDetails
  needsReview: boolean
  review?: {
    decision: ReviewDecision
    note?: string
    projectionVersion: number
    current: boolean
    createdAt: string
  }
}

export class MasteryService {
  constructor(
    private readonly content: ContentRepository,
    private readonly training: TrainingStateRepository,
    private readonly repository: MasteryRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(context: RequestContext) {
    const kidId = this.kidId(context)
    const [knowledgePoints, evidence] = await Promise.all([
      this.content.listKnowledgePoints(context.familyId),
      this.training.listAnswerEvidence(context.familyId, kidId),
    ])
    const byKnowledgePoint = groupEvidence(evidence)
    const knowledgePointById = new Map(
      knowledgePoints.map((item) => [item.id, item]),
    )
    const projections = await Promise.all(
      [...byKnowledgePoint.entries()].flatMap(([kpId, items]) => {
        const knowledgePoint = knowledgePointById.get(kpId)
        return knowledgePoint
          ? [
              this.repository.saveProjection(
                calculateMasteryProjection(
                  context.familyId,
                  kidId,
                  knowledgePoint,
                  items,
                ),
              ),
            ]
          : []
      }),
    )
    const reviews = await this.repository.listLatestReviews(
      context.familyId,
      kidId,
    )
    const items = projections
      .map((projection) =>
        toListItem(
          projection,
          knowledgePointById.get(projection.kpId)!,
          reviews.get(projection.id),
        ),
      )
      .sort(
        (left, right) =>
          Number(right.needsReview) - Number(left.needsReview) ||
          right.evidenceTo.localeCompare(left.evidenceTo) ||
          left.knowledgePointName.localeCompare(
            right.knowledgePointName,
            'zh-CN',
          ),
      )

    return {
      modelVersion,
      summary: {
        mastered: items.filter((item) => item.status === 'mastered').length,
        hintDependent: items.filter(
          (item) => item.calculationDetails.hintDependence > 0,
        ).length,
        needsReview: items.filter((item) => item.needsReview).length,
        insufficient: items.filter((item) => item.status === 'insufficient')
          .length,
      },
      projections: items,
    }
  }

  async evidence(context: RequestContext, kpId: string) {
    const listed = await this.list(context)
    const projection = listed.projections.find((item) => item.kpId === kpId)
    if (!projection) throw new Error('MASTERY_PROJECTION_NOT_FOUND')
    const evidence = (
      await this.training.listAnswerEvidence(
        context.familyId,
        this.kidId(context),
      )
    )
      .filter((item) => item.kpId === kpId)
      .map((item) => ({
        id: item.id,
        questionId: item.questionId,
        correct: item.correct,
        hintLevel: item.hintLevel,
        durationMs: item.durationMs ?? null,
        submittedAt: item.submittedAt,
      }))
    return { projection, evidence }
  }

  async review(
    context: RequestContext,
    kpId: string,
    input: {
      projectionVersion: number
      decision: ReviewDecision
      note?: string
    },
  ) {
    const listed = await this.list(context)
    const projection = listed.projections.find((item) => item.kpId === kpId)
    if (!projection) throw new Error('MASTERY_PROJECTION_NOT_FOUND')
    if (projection.status === 'insufficient') {
      throw new Error('MASTERY_EVIDENCE_INSUFFICIENT')
    }
    return this.repository.saveReview({
      familyId: context.familyId,
      projectionId: projection.projectionId,
      projectionVersion: input.projectionVersion,
      reviewerId: context.userId,
      decision: input.decision,
      ...(input.note ? { note: input.note } : {}),
    })
  }

  async weeklyReport(context: RequestContext) {
    const now = this.clock()
    const periodEnd = now.toISOString()
    const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000)
    const previousStart = new Date(
      periodStart.getTime() - 7 * 24 * 60 * 60 * 1_000,
    )
    const [listed, evidence] = await Promise.all([
      this.list(context),
      this.training.listAnswerEvidence(
        context.familyId,
        this.kidId(context),
      ),
    ])
    const current = evidence.filter(
      (item) =>
        item.submittedAt >= periodStart.toISOString() &&
        item.submittedAt <= periodEnd,
    )
    const previous = evidence.filter(
      (item) =>
        item.submittedAt >= previousStart.toISOString() &&
        item.submittedAt < periodStart.toISOString(),
    )
    const currentAccuracy = evidenceAccuracy(current)
    const previousAccuracy = evidenceAccuracy(previous)
    const focus = listed.projections
      .filter(
        (item) =>
          item.status === 'weak' ||
          item.status === 'basic' ||
          item.status === 'insufficient',
      )
      .slice(0, 3)
      .map((item) => ({
        kpId: item.kpId,
        name: item.knowledgePointName,
        status: item.status,
        score: item.score,
        hintDependence: item.calculationDetails.hintDependence,
      }))
    return {
      generatedAt: periodEnd,
      period: {
        from: periodStart.toISOString(),
        to: periodEnd,
      },
      overview: {
        attempts: current.length,
        independentAttempts: current.filter(
          (item) => item.hintLevel === 0,
        ).length,
        accuracy: currentAccuracy,
        mastered: listed.summary.mastered,
        needsReview: listed.summary.needsReview,
      },
      trend: {
        previousAccuracy,
        change:
          currentAccuracy === null || previousAccuracy === null
            ? null
            : round(currentAccuracy - previousAccuracy),
        direction:
          currentAccuracy === null || previousAccuracy === null
            ? 'insufficient'
            : currentAccuracy > previousAccuracy
              ? 'up'
              : currentAccuracy < previousAccuracy
                ? 'down'
                : 'flat',
      },
      focus,
      suggestions: reportSuggestions(current, focus),
    }
  }

  async close(): Promise<void> {
    await this.repository.close()
  }

  private kidId(context: RequestContext): string {
    return context.kidId ?? context.userId
  }
}

export function calculateMasteryProjection(
  familyId: string,
  kidId: string,
  knowledgePoint: KnowledgePoint,
  unsortedEvidence: AnswerEvidence[],
): SaveProjectionInput {
  const evidence = [...unsortedEvidence].sort(
    (left, right) =>
      left.submittedAt.localeCompare(right.submittedAt) ||
      left.id.localeCompare(right.id),
  )
  if (!evidence.length) throw new Error('MASTERY_EVIDENCE_EMPTY')

  const sampleCount = evidence.length
  const independent = evidence.filter((item) => item.hintLevel === 0)
  const independentCorrectCount = independent.filter(
    (item) => item.correct,
  ).length
  const accuracy = independentCorrectCount / sampleCount
  const hintDependence =
    evidence.reduce((sum, item) => sum + item.hintLevel / 3, 0) / sampleCount
  const spacedDayCount = new Set(
    evidence.map((item) => localDate(item.submittedAt)),
  ).size
  const firstDay = localDate(evidence[0]!.submittedAt)
  const retentionEvidence = evidence.filter(
    (item) => localDate(item.submittedAt) !== firstDay,
  )
  const stability = retentionEvidence.length
    ? retentionEvidence.filter(
        (item) => item.correct && item.hintLevel === 0,
      ).length / retentionEvidence.length
    : 0
  const durationEvidence = evidence.filter(
    (item) => item.durationMs !== undefined && item.durationMs > 0,
  )
  const averageDurationMs = durationEvidence.length
    ? Math.round(
        durationEvidence.reduce(
          (sum, item) => sum + item.durationMs!,
          0,
        ) / durationEvidence.length,
      )
    : null
  const speed = averageDurationMs
    ? Math.min(1, baselineDurationMs / averageDurationMs)
    : 0
  const score = round(
    0.45 * accuracy +
      0.3 * (1 - hintDependence) +
      0.15 * stability +
      0.1 * speed,
  )
  const latest = evidence.at(-1)!
  const latestIndependentCorrect =
    latest.correct && latest.hintLevel === 0
  const insufficiencyReasons = [
    ...(sampleCount < 3 ? ['sample_count'] : []),
    ...(independent.length < 2 ? ['independent_count'] : []),
    ...(spacedDayCount < 2 ? ['spaced_day_count'] : []),
    ...(durationEvidence.length < 2 ? ['speed_evidence'] : []),
  ]
  const status = masteryStatus({
    insufficiencyReasons,
    score,
    accuracy,
    latestIndependentCorrect,
  })

  return {
    familyId,
    kidId,
    kpId: knowledgePoint.id,
    modelVersion,
    status,
    score: status === 'insufficient' ? null : score,
    sampleCount,
    independentCount: independent.length,
    independentCorrectCount,
    spacedDayCount,
    evidenceFrom: evidence[0]!.submittedAt,
    evidenceTo: latest.submittedAt,
    evidenceFingerprint: createHash('sha256')
      .update(
        JSON.stringify(
          evidence.map((item) => [
            item.id,
            item.correct,
            item.hintLevel,
            item.durationMs ?? null,
            item.submittedAt,
          ]),
        ),
      )
      .digest('hex'),
    calculationDetails: {
      accuracy: round(accuracy),
      hintDependence: round(hintDependence),
      averageHintLevel: round(hintDependence * 3),
      stability: round(stability),
      speed: round(speed),
      averageDurationMs,
      latestIndependentCorrect,
      insufficiencyReasons,
    },
  }
}

function masteryStatus(input: {
  insufficiencyReasons: string[]
  score: number
  accuracy: number
  latestIndependentCorrect: boolean
}): MasteryStatus {
  if (input.insufficiencyReasons.length) return 'insufficient'
  if (
    input.score >= 0.85 &&
    input.accuracy >= 0.8 &&
    input.latestIndependentCorrect
  ) {
    return 'mastered'
  }
  return input.score >= 0.6 ? 'basic' : 'weak'
}

function groupEvidence(
  evidence: AnswerEvidence[],
): Map<string, AnswerEvidence[]> {
  const grouped = new Map<string, AnswerEvidence[]>()
  for (const item of evidence) {
    grouped.set(item.kpId, [...(grouped.get(item.kpId) ?? []), item])
  }
  return grouped
}

function toListItem(
  projection: MasteryProjection,
  knowledgePoint: KnowledgePoint,
  review: MasteryReview | undefined,
): MasteryListItem {
  const reviewCurrent =
    review?.projectionVersion === projection.projectionVersion
  return {
    projectionId: projection.id,
    projectionVersion: projection.projectionVersion,
    modelVersion: projection.modelVersion,
    kpId: projection.kpId,
    knowledgePointName: knowledgePoint.name,
    chapter: knowledgePoint.chapter,
    status: projection.status,
    score: projection.score,
    sampleCount: projection.sampleCount,
    independentCount: projection.independentCount,
    independentCorrectCount: projection.independentCorrectCount,
    spacedDayCount: projection.spacedDayCount,
    evidenceFrom: projection.evidenceFrom,
    evidenceTo: projection.evidenceTo,
    calculationDetails: projection.calculationDetails,
    needsReview: projection.status !== 'insufficient' && !reviewCurrent,
    ...(review
      ? {
          review: {
            decision: review.decision,
            ...(review.note ? { note: review.note } : {}),
            projectionVersion: review.projectionVersion,
            current: reviewCurrent,
            createdAt: review.createdAt,
          },
        }
      : {}),
  }
}

function localDate(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}

function evidenceAccuracy(evidence: AnswerEvidence[]): number | null {
  if (!evidence.length) return null
  return round(
    evidence.filter((item) => item.correct && item.hintLevel === 0).length /
      evidence.length,
  )
}

function reportSuggestions(
  evidence: AnswerEvidence[],
  focus: Array<{
    name: string
    status: MasteryStatus
    hintDependence: number
  }>,
): string[] {
  if (!evidence.length) {
    return ['本周学习证据较少，先安排一次 10-15 分钟的轻量复习。']
  }
  const suggestions = focus.map((item) =>
    item.hintDependence > 0.34
      ? `和孩子一起回顾“${item.name}”的判断方法，先让孩子说思路，再决定是否需要提示。`
      : `用一道变式题复查“${item.name}”，重点观察能否独立完成。`,
  )
  return suggestions.length
    ? suggestions
    : ['本周状态稳定，可以保持当前节奏，并留出一天完全休息。']
}
