import type { RequestContext } from '@kid-study/contracts'
import type { AssessmentService } from './assessment-service.js'
import type { PlanningService } from '../planning/planning-service.js'

const familyId = '11111111-1111-4111-8111-111111111111'
const parentId = '22222222-2222-4222-8222-222222222222'
const kidId = '33333333-3333-4333-8333-333333333333'

export class RoutineAssessmentScheduler {
  private timer: NodeJS.Timeout | undefined
  private lastRunDate?: string

  constructor(
    private readonly assessments: AssessmentService,
    private readonly planning: PlanningService,
    private readonly clock: () => Date = () => new Date(),
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  start(): void {
    if (this.timer) return
    void this.runIfDue().catch(this.onError)
    this.timer = setInterval(
      () => void this.runIfDue().catch(this.onError),
      60_000,
    )
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async runIfDue(force = false): Promise<boolean> {
    const now = this.clock()
    const local = shanghaiParts(now)
    if (!force && local.hour !== 2) return false
    if (this.lastRunDate === local.date) return false
    if (!this.assessments.isConfigured(familyId)) return false

    const assessment = await this.assessments.createRoutine({
      familyId,
      kidId,
      createdBy: parentId,
      count: 3,
    })
    const context: RequestContext = {
      requestId: `routine:${local.date}`,
      userId: parentId,
      role: 'parent',
      familyId,
      kidId,
      deviceId: 'system-routine-scheduler',
    }
    await this.planning.createTask(context, {
      source: 'system',
      kind: 'practice',
      title: '今晚例行考察',
      description: `系统已按近期学习证据准备 ${assessment.questionIds.length} 道题。`,
      subject: '数学',
      dueAt: `${local.date}T12:00:00.000Z`,
      estimatedMinutes: 15,
      priority: 2,
    })
    this.lastRunDate = local.date
    return true
  }
}

function shanghaiParts(date: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
  }
}
