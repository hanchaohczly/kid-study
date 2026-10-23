import { randomUUID } from 'node:crypto'
import type { RequestContext } from '@kid-study/contracts'
import { z } from 'zod'
import type {
  OptionHints,
  QuestionPrivate,
  QuestionPrivateRepository,
  QuestionPublic,
  QuestionPublicRepository,
} from '../content/content-repository.js'
import type { AssessmentRepository } from '../assessments/assessment-service.js'
import type { GuideService } from '../guide/guide-service.js'
import type { ModelRouter } from '../models/model-router.js'
import type {
  TrainingSession,
  TrainingStateRepository,
} from './training-state-repository.js'
import type { WrongAnswerCollector } from '../wrong-book/wrong-book-service.js'
import type { PlanningService } from '../planning/planning-service.js'

const closeAfterMs = 30 * 60 * 1_000

export interface SubjectiveAnswerGrader {
  isConfigured(familyId: string): boolean
  grade(input: {
    familyId: string
    question: QuestionPublic
    privateQuestion: QuestionPrivate
    answer: string
  }): Promise<{ correct: boolean; score: number; feedback: string }>
}

export class TrainingService {
  constructor(
    private readonly publicQuestions: QuestionPublicRepository,
    private readonly privateQuestions: QuestionPrivateRepository,
    private readonly assessments: AssessmentRepository,
    private readonly state: TrainingStateRepository,
    private readonly guide: GuideService,
    private readonly clock: () => Date = () => new Date(),
    private readonly subjectiveGrader?: SubjectiveAnswerGrader,
    private readonly wrongAnswers?: WrongAnswerCollector,
    private readonly planning?: PlanningService,
  ) {}

  async getToday(context: RequestContext) {
    const now = this.clock()
    const localDate = this.localDate(now)
    const kidId = this.kidId(context)
    const questionIds = [
      ...new Set([
        ...(await this.assessments.listAssignedQuestionIds(
          context.familyId,
          kidId,
          localDate,
        )),
        ...(this.planning
          ? await this.planning.dueQuestionIds(
              context.familyId,
              kidId,
              now.toISOString(),
            )
          : []),
      ]),
    ]
    const questions = await this.publicQuestions.listPublishedQuestionsByIds(
      context.familyId,
      questionIds,
    )
    const session = await this.state.findSession(
      context.familyId,
      kidId,
      localDate,
    )
    const activeAttempt = session
      ? await this.state.findOpenAttempt(session.id)
      : undefined
    if (
      session &&
      this.elapsedMs(session, now) >= closeAfterMs &&
      !activeAttempt
    ) {
      await this.state.closeSession(session.id, now.toISOString())
      session.closedAt = now.toISOString()
    }

    const knowledgePointNames = [
      ...new Set(questions.map((question) => question.knowledgePointName)),
    ]
    return {
      planId: `today:${context.familyId}:${localDate}`,
      ...(session ? { sessionId: session.id } : {}),
      localDate,
      title:
        knowledgePointNames.length === 1
          ? knowledgePointNames[0]
          : '今日数学训练',
      estimatedMinutes: questions.length * 5,
      stopAddingAtMinutes: 25,
      closeAtMinutes: 30,
      budget: session
        ? this.budget(session, now)
        : {
            serverStartedAt: null,
            elapsedSeconds: 0,
            remainingSeconds: 30 * 60,
            stopAddingQuestions: false,
            sessionClosed: false,
          },
      ...(activeAttempt
        ? {
            activeAttempt: {
              attemptId: activeAttempt.id,
              questionId: activeAttempt.questionId,
              hintLevel: activeAttempt.hintLevel,
            },
          }
        : {}),
      questions: questions.map(
        ({
          familyId: _,
          knowledgePointName: __,
          status: ___,
          createdAt: ____,
          updatedAt: _____,
          ...question
        }) => question,
      ),
    }
  }

  async startAttempt(
    context: RequestContext,
    input: { attemptId: string; questionId: string },
  ) {
    const now = this.clock()
    const question = await this.requirePublicQuestion(context, input.questionId)
    const kidId = this.kidId(context)
    const localDate = this.localDate(now)
    const session =
      (await this.state.findSession(context.familyId, kidId, localDate)) ??
      (await this.state.getOrCreateSession(
        context.familyId,
        kidId,
        localDate,
        now.toISOString(),
      ))
    const budget = this.budget(session, now)
    const existing = await this.state.findAttempt(input.attemptId)
    if (existing) {
      if (
        existing.sessionId !== session.id ||
        existing.familyId !== context.familyId ||
        existing.kidId !== this.kidId(context) ||
        existing.questionId !== question.id
      ) {
        throw new Error('ATTEMPT_NOT_FOUND')
      }
      return { attemptId: input.attemptId, budget }
    }
    if (budget.sessionClosed) throw new Error('SESSION_CLOSED')
    if (budget.stopAddingQuestions) throw new Error('SESSION_LIMIT_REACHED')
    if (await this.state.findOpenAttempt(session.id)) {
      throw new Error('ATTEMPT_IN_PROGRESS')
    }

    const result = await this.state.startAttempt({
      id: input.attemptId,
      sessionId: session.id,
      familyId: context.familyId,
      kidId: this.kidId(context),
      questionId: question.id,
      startedAt: now.toISOString(),
    })
    if (result === 'conflict') throw new Error('ATTEMPT_NOT_FOUND')
    return { attemptId: input.attemptId, budget }
  }

  async checkAnswer(
    context: RequestContext,
    input: {
      submissionId?: string
      attemptId: string
      questionId: string
      answer: string
      finalizeAttempt?: boolean
    },
  ) {
    const now = this.clock()
    const question = await this.requirePublicQuestion(context, input.questionId)
    if (input.submissionId) {
      const existing = await this.state.findAnswerSubmission(input.submissionId)
      if (existing) {
        const { attempt, session } = await this.requireAttempt(
          context,
          input.attemptId,
          question,
        )
        if (
          existing.familyId !== context.familyId ||
          existing.kidId !== this.kidId(context) ||
          existing.attemptId !== input.attemptId ||
          existing.questionId !== question.id ||
          existing.answer !== input.answer
        ) {
          throw new Error('ANSWER_SUBMISSION_CONFLICT')
        }
        if (input.finalizeAttempt && !attempt.completedAt) {
          await this.state.completeAttempt(input.attemptId, now.toISOString())
        }
        return {
          correct: existing.correct,
          nextAction: existing.correct
            ? ('continue' as const)
            : ('try_again' as const),
          ...(question.questionType === 'subjective'
            ? {
                score: existing.correct ? 100 : 0,
                feedback: '已恢复此前提交的评分结果。',
              }
            : {}),
          budget: this.budget(session, now),
        }
      }
    }
    const { attempt, session } = await this.requireAttempt(
      context,
      input.attemptId,
      question,
    )
    if (attempt.completedAt) throw new Error('ATTEMPT_COMPLETED')
    const privateQuestion = await this.privateQuestions.findQuestionPrivate(
      context.familyId,
      question.id,
    )
    if (!privateQuestion) throw new Error('QUESTION_NOT_FOUND')

    const grading =
      question.questionType === 'subjective'
        ? await this.gradeSubjective(
            context.familyId,
            question,
            privateQuestion,
            input.answer,
          )
        : {
            correct: input.answer === privateQuestion.answerKey,
            score: input.answer === privateQuestion.answerKey ? 100 : 0,
            feedback: '',
          }
    const correct = grading.correct
    const submissionId = input.submissionId ?? randomUUID()
    const recorded = await this.state.recordAnswer({
      id: submissionId,
      attemptId: input.attemptId,
      familyId: context.familyId,
      kidId: this.kidId(context),
      questionId: question.id,
      kpId: question.kpId,
      answer: input.answer,
      correct,
      hintLevel: attempt.hintLevel,
      durationMs: Math.max(
        0,
        now.getTime() - new Date(attempt.startedAt).getTime(),
      ),
      submittedAt: now.toISOString(),
    })
    if (recorded === 'conflict') {
      throw new Error('ANSWER_SUBMISSION_CONFLICT')
    }
    if (recorded === 'recorded' && this.planning) {
      await this.planning.recordAnswer({
        familyId: context.familyId,
        kidId: this.kidId(context),
        kpId: question.kpId,
        questionId: question.id,
        submissionId,
        correct,
        submittedAt: now.toISOString(),
      })
    }
    if (!correct && this.wrongAnswers) {
      await this.wrongAnswers.captureSystemWrong({
        familyId: context.familyId,
        kidId: this.kidId(context),
        submissionId,
        question,
        privateQuestion,
        studentAnswer: input.answer,
        occurredAt: now.toISOString(),
      })
    }
    if (correct || input.finalizeAttempt) {
      await this.state.completeAttempt(input.attemptId, now.toISOString())
      if (this.elapsedMs(session, now) >= closeAfterMs) {
        await this.state.closeSession(session.id, now.toISOString())
        session.closedAt = now.toISOString()
      }
    }
    return {
      correct,
      nextAction: correct ? ('continue' as const) : ('try_again' as const),
      ...(question.questionType === 'subjective'
        ? { score: grading.score, feedback: grading.feedback }
        : {}),
      budget: this.budget(session, now),
    }
  }

  async getHint(
    context: RequestContext,
    input: {
      attemptId: string
      questionId: string
      selectedAnswer: keyof OptionHints
      kidInput: string
    },
  ) {
    const question = await this.requirePublicQuestion(context, input.questionId)
    const { attempt } = await this.requireAttempt(
      context,
      input.attemptId,
      question,
    )
    if (attempt.completedAt) throw new Error('ATTEMPT_COMPLETED')
    const privateQuestion = await this.privateQuestions.findQuestionPrivate(
      context.familyId,
      question.id,
    )
    if (!privateQuestion) throw new Error('QUESTION_NOT_FOUND')

    const nextLevel = Math.min(attempt.hintLevel + 1, 3) as 1 | 2 | 3
    const commonInput = {
      familyId: context.familyId,
      kidId: this.kidId(context),
      attemptId: input.attemptId,
      question,
      privateQuestion,
      level: nextLevel,
    }
    const precomputedText =
      privateQuestion.optionHints[input.selectedAnswer]?.[nextLevel - 1]
    const precomputed = precomputedText
      ? await this.guide.createPrecomputed({
          ...commonInput,
          text: precomputedText,
        })
      : undefined
    const result =
      precomputed ??
      (await this.guide.create({
        ...commonInput,
        kidInput: input.kidInput,
      }))
    await this.state.setHintLevel(input.attemptId, nextLevel)
    return {
      attemptId: input.attemptId,
      ...result,
    }
  }

  async close(): Promise<void> {
    await this.state.close()
  }

  private async requireAttempt(
    context: RequestContext,
    attemptId: string,
    question: QuestionPublic,
  ) {
    const attempt = await this.state.findAttempt(attemptId)
    const session = await this.requireTodaySession(context)
    if (
      !attempt ||
      attempt.sessionId !== session.id ||
      attempt.familyId !== context.familyId ||
      attempt.kidId !== this.kidId(context) ||
      attempt.questionId !== question.id
    ) {
      throw new Error('ATTEMPT_NOT_FOUND')
    }
    return { attempt, session }
  }

  private async gradeSubjective(
    familyId: string,
    question: QuestionPublic,
    privateQuestion: QuestionPrivate,
    answer: string,
  ) {
    if (!this.subjectiveGrader?.isConfigured(familyId)) {
      throw new Error('SUBJECTIVE_GRADER_NOT_CONFIGURED')
    }
    return this.subjectiveGrader.grade({
      familyId,
      question,
      privateQuestion,
      answer,
    })
  }

  private async requireTodaySession(
    context: RequestContext,
  ): Promise<TrainingSession> {
    const session = await this.state.findSession(
      context.familyId,
      this.kidId(context),
      this.localDate(this.clock()),
    )
    if (!session) throw new Error('TRAINING_SESSION_NOT_FOUND')
    return session
  }

  private async requirePublicQuestion(
    context: RequestContext,
    questionId: string,
  ) {
    const assigned = await this.assessments.isQuestionAssigned(
      context.familyId,
      this.kidId(context),
      questionId,
    )
    if (!assigned) throw new Error('QUESTION_NOT_FOUND')
    const question = await this.publicQuestions.findPublishedQuestion(
      context.familyId,
      questionId,
    )
    if (!question) throw new Error('QUESTION_NOT_FOUND')
    return question
  }

  private budget(session: TrainingSession, now: Date) {
    const elapsedSeconds = Math.floor(this.elapsedMs(session, now) / 1_000)
    return {
      serverStartedAt: session.startedAt,
      elapsedSeconds,
      remainingSeconds: Math.max(0, 30 * 60 - elapsedSeconds),
      stopAddingQuestions:
        Boolean(session.closedAt) || elapsedSeconds >= 25 * 60,
      sessionClosed: Boolean(session.closedAt),
    }
  }

  private elapsedMs(session: TrainingSession, now: Date): number {
    return Math.max(0, now.getTime() - new Date(session.startedAt).getTime())
  }

  private kidId(context: RequestContext): string {
    return context.kidId ?? context.userId
  }

  private localDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
    }).format(date)
  }
}

const subjectiveGradeSchema = z.object({
  score: z.number().int().min(0).max(100),
  correct: z.boolean(),
  feedback: z.string().trim().min(1).max(500),
})

export class OpenAiCompatibleSubjectiveAnswerGrader
  implements SubjectiveAnswerGrader
{
  constructor(private readonly router: ModelRouter) {}

  isConfigured(familyId: string): boolean {
    return this.router.isConfigured(familyId, 'chat')
  }

  async grade(input: {
    familyId: string
    question: QuestionPublic
    privateQuestion: QuestionPrivate
    answer: string
  }): Promise<{ correct: boolean; score: number; feedback: string }> {
    const result = await this.router.chatJson<unknown>(input.familyId, {
      temperature: 0,
      maxRetries: 0,
      timeoutMs: 60_000,
      messages: [
        {
          role: 'system',
          content: [
            '你是严格的初中数学主观题评分器，只输出 JSON。',
            '根据评分点判断学生答案是否已经达到可通过标准。',
            'correct 仅在关键结论正确且主要推理完整时为 true，通常对应 score >= 60。',
            'feedback 只指出学生已经做到的部分和下一步改进方向。',
            '禁止在 feedback 中给出参考答案、最终数值、完整证明或完整解题过程。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            question: input.question.stem,
            studentAnswer: input.answer,
            referenceAnswer: input.privateQuestion.answerKey,
            referenceSteps: input.privateQuestion.referenceSteps,
            scoringPoints: input.privateQuestion.scoringPoints,
            outputSchema: {
              score: '0-100 整数',
              correct: '布尔值',
              feedback: '不泄露答案的简短反馈',
            },
          }),
        },
      ],
    })
    const root = asRecord(result.data)
    const candidate =
      asRecord(root?.data) ?? asRecord(root?.result) ?? asRecord(root?.grade) ?? root
    const parsed = subjectiveGradeSchema.parse(candidate)
    return {
      ...parsed,
      correct: parsed.correct && parsed.score >= 60,
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
