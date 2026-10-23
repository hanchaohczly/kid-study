import type { RequestContext } from '@kid-study/contracts'
import type { ContentRepository } from '../content/content-repository.js'
import type {
  CurriculumProgress,
  LearningTask,
  PlanningRepository,
  ProgressSource,
  ReviewStage,
  TaskKind,
  TaskSource,
  TaskStatus,
} from './planning-repository.js'

const dayMs = 24 * 60 * 60 * 1_000

export class PlanningService {
  constructor(
    private readonly repository: PlanningRepository,
    private readonly content: ContentRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async listTasks(context: RequestContext) {
    const kidId = this.kidId(context)
    const tasks = await this.repository.listTasks(context.familyId, kidId)
    const now = this.clock().toISOString()
    const pending = tasks.filter((task) => task.status === 'pending')
    const overdue = pending.filter(
      (task) => task.dueAt && task.dueAt < now,
    )
    const plannedMinutes = pending.reduce(
      (sum, task) => sum + task.estimatedMinutes,
      0,
    )
    const recommendedMinutes = Math.max(
      5,
      Math.min(30, 30 - overdue.length * 5),
    )
    return {
      tasks,
      workload: {
        plannedMinutes,
        overdueCount: overdue.length,
        recommendedMinutes,
        reduced:
          plannedMinutes > recommendedMinutes || overdue.length > 0,
      },
    }
  }

  async createTask(
    context: RequestContext,
    input: {
      source: TaskSource
      kind: TaskKind
      title: string
      description: string
      subject: string
      kpId?: string
      dueAt?: string
      estimatedMinutes: number
      priority: 1 | 2 | 3
    },
  ): Promise<LearningTask> {
    const kidId = this.kidId(context)
    if (input.kpId) await this.requireKnowledgePoint(context.familyId, input.kpId)
    return this.repository.createTask({
      familyId: context.familyId,
      kidId,
      createdBy: context.userId,
      ...input,
    })
  }

  async changeTaskStatus(
    context: RequestContext,
    id: string,
    status: TaskStatus,
  ): Promise<LearningTask> {
    if (context.role === 'child' && status !== 'claimed_done') {
      throw new Error('TASK_TRANSITION_FORBIDDEN')
    }
    if (
      context.role === 'parent' &&
      !['verified', 'cancelled', 'pending'].includes(status)
    ) {
      throw new Error('TASK_TRANSITION_FORBIDDEN')
    }
    const updated = await this.repository.changeTaskStatus(
      context.familyId,
      this.kidId(context),
      id,
      status,
      this.clock().toISOString(),
    )
    if (!updated) throw new Error('TASK_NOT_FOUND')
    return updated
  }

  listProgress(context: RequestContext): Promise<CurriculumProgress[]> {
    return this.repository.listProgress(context.familyId, this.kidId(context))
  }

  async createProgress(
    context: RequestContext,
    input: {
      subject: string
      chapter: string
      kpId?: string
      source: ProgressSource
      confidence: number
      effectiveDate: string
    },
  ): Promise<CurriculumProgress> {
    if (input.kpId) await this.requireKnowledgePoint(context.familyId, input.kpId)
    return this.repository.createProgress({
      familyId: context.familyId,
      kidId: this.kidId(context),
      ...input,
      mappingStatus:
        input.kpId && input.confidence >= 0.8 ? 'mapped' : 'unmapped',
    })
  }

  async confirmProgress(
    context: RequestContext,
    id: string,
    kpId: string,
  ): Promise<CurriculumProgress> {
    const knowledgePoint = await this.requireKnowledgePoint(
      context.familyId,
      kpId,
    )
    const confirmed = await this.repository.confirmProgress(
      context.familyId,
      this.kidId(context),
      id,
      context.userId,
      kpId,
      this.clock().toISOString(),
    )
    if (!confirmed) throw new Error('PROGRESS_NOT_FOUND')

    const dueAt = previewDueAt(confirmed.effectiveDate)
    await this.repository.createTask({
      familyId: context.familyId,
      kidId: confirmed.kidId,
      source: 'system',
      kind: 'preview',
      title: `预习：${knowledgePoint.name}`,
      description: `结合教学进度预习“${confirmed.chapter}”，先回忆前置知识，再完成 1-3 道基础检查题。`,
      subject: confirmed.subject,
      kpId,
      dueAt,
      estimatedMinutes: 15,
      priority: 1,
      createdBy: context.userId,
    })
    return confirmed
  }

  async dueQuestionIds(
    familyId: string,
    kidId: string,
    dueBefore: string,
  ): Promise<string[]> {
    const reviews = await this.repository.listDueReviews(
      familyId,
      kidId,
      dueBefore,
    )
    return [...new Set(reviews.map((item) => item.questionId))]
  }

  async listDueReviews(context: RequestContext) {
    return this.repository.listDueReviews(
      context.familyId,
      this.kidId(context),
      this.clock().toISOString(),
    )
  }

  async recordAnswer(input: {
    familyId: string
    kidId: string
    kpId: string
    questionId: string
    submissionId: string
    correct: boolean
    submittedAt: string
  }): Promise<void> {
    const pending = await this.repository.findPendingReview(
      input.familyId,
      input.kidId,
      input.questionId,
    )
    if (!input.correct) {
      if (pending) {
        await this.repository.finishReview({
          familyId: input.familyId,
          id: pending.id,
          submissionId: input.submissionId,
          status: 'superseded',
          completedAt: input.submittedAt,
        })
      }
      await this.repository.saveReview({
        familyId: input.familyId,
        kidId: input.kidId,
        kpId: input.kpId,
        questionId: input.questionId,
        sourceSubmissionId: input.submissionId,
        stage: 't1',
        dueAt: addDays(input.submittedAt, 1),
      })
      return
    }
    if (!pending) return

    await this.repository.finishReview({
      familyId: input.familyId,
      id: pending.id,
      submissionId: input.submissionId,
      status: 'completed',
      completedAt: input.submittedAt,
    })
    const next = nextReview(pending.stage)
    await this.repository.saveReview({
      familyId: input.familyId,
      kidId: input.kidId,
      kpId: input.kpId,
      questionId: input.questionId,
      sourceSubmissionId: input.submissionId,
      stage: next.stage,
      dueAt: addDays(input.submittedAt, next.days),
    })
  }

  async close(): Promise<void> {
    await this.repository.close()
  }

  private kidId(context: RequestContext): string {
    return context.kidId ?? context.userId
  }

  private async requireKnowledgePoint(familyId: string, kpId: string) {
    const item = (await this.content.listKnowledgePoints(familyId)).find(
      (point) => point.id === kpId && point.status === 'published',
    )
    if (!item) throw new Error('KNOWLEDGE_POINT_NOT_FOUND')
    return item
  }
}

function nextReview(stage: ReviewStage): {
  stage: ReviewStage
  days: number
} {
  switch (stage) {
    case 't1':
      return { stage: 't3', days: 2 }
    case 't3':
      return { stage: 't14', days: 11 }
    case 't14':
      return { stage: 'maintenance', days: 16 }
    case 'maintenance':
      return { stage: 'maintenance', days: 30 }
  }
}

function addDays(timestamp: string, days: number): string {
  return new Date(new Date(timestamp).getTime() + days * dayMs).toISOString()
}

function previewDueAt(effectiveDate: string): string {
  const effective = new Date(`${effectiveDate}T12:00:00+08:00`)
  return new Date(effective.getTime() - 16 * 60 * 60 * 1_000).toISOString()
}
