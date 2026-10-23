import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@kid-study/contracts'
import { InMemoryContentRepository } from '../content/in-memory-content-repository.js'
import { InMemoryPlanningRepository } from './planning-repository.js'
import { PlanningService } from './planning-service.js'

const familyId = '11111111-1111-4111-8111-111111111111'
const parentId = '22222222-2222-4222-8222-222222222222'
const kidId = '33333333-3333-4333-8333-333333333333'
const kpId = '20000000-0000-4000-8000-000000000001'
const questionId = '10000000-0000-4000-8000-000000000001'

const parentContext: RequestContext = {
  requestId: 'request-parent',
  userId: parentId,
  role: 'parent',
  familyId,
  kidId,
  deviceId: 'device-parent',
}
const childContext: RequestContext = {
  requestId: 'request-child',
  userId: kidId,
  role: 'child',
  familyId,
  kidId,
  deviceId: 'device-child',
}

function createService(now = '2026-10-14T12:00:00.000Z') {
  return new PlanningService(
    new InMemoryPlanningRepository(),
    new InMemoryContentRepository({ seedDemoContent: true }),
    () => new Date(now),
  )
}

describe('PlanningService', () => {
  it('supports child claim and parent verification with workload reduction', async () => {
    const service = createService()
    const task = await service.createTask(parentContext, {
      source: 'school',
      kind: 'homework',
      title: '完成数学作业',
      description: '',
      subject: '数学',
      dueAt: '2026-10-13T12:00:00.000Z',
      estimatedMinutes: 40,
      priority: 1,
    })

    const listed = await service.listTasks(childContext)
    expect(listed.workload).toEqual({
      plannedMinutes: 40,
      overdueCount: 1,
      recommendedMinutes: 25,
      reduced: true,
    })

    await expect(
      service.changeTaskStatus(childContext, task.id, 'verified'),
    ).rejects.toThrow('TASK_TRANSITION_FORBIDDEN')
    const claimed = await service.changeTaskStatus(
      childContext,
      task.id,
      'claimed_done',
    )
    expect(claimed.status).toBe('claimed_done')
    const verified = await service.changeTaskStatus(
      parentContext,
      task.id,
      'verified',
    )
    expect(verified.status).toBe('verified')
  })

  it('requires confirmation for uncertain curriculum mapping and creates preview', async () => {
    const service = createService()
    const progress = await service.createProgress(parentContext, {
      subject: '数学',
      chapter: '一元一次方程',
      source: 'schedule_ocr',
      confidence: 0.62,
      effectiveDate: '2026-10-15',
    })
    expect(progress.mappingStatus).toBe('unmapped')

    const confirmed = await service.confirmProgress(
      parentContext,
      progress.id,
      kpId,
    )
    expect(confirmed).toMatchObject({
      mappingStatus: 'confirmed',
      confidence: 1,
      kpId,
    })
    const tasks = await service.listTasks(parentContext)
    expect(tasks.tasks[0]).toMatchObject({
      kind: 'preview',
      subject: '数学',
      kpId,
      estimatedMinutes: 15,
    })
  })

  it('advances T+1, T+3, T+14 and maintenance reviews', async () => {
    const service = createService()
    await service.recordAnswer({
      familyId,
      kidId,
      kpId,
      questionId,
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      correct: false,
      submittedAt: '2026-10-14T08:00:00.000Z',
    })
    expect(
      await service.dueQuestionIds(
        familyId,
        kidId,
        '2026-10-15T08:00:00.000Z',
      ),
    ).toEqual([questionId])

    await service.recordAnswer({
      familyId,
      kidId,
      kpId,
      questionId,
      submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      correct: true,
      submittedAt: '2026-10-15T08:00:00.000Z',
    })
    expect(
      await service.dueQuestionIds(
        familyId,
        kidId,
        '2026-10-17T08:00:00.000Z',
      ),
    ).toEqual([questionId])

    await service.recordAnswer({
      familyId,
      kidId,
      kpId,
      questionId,
      submissionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      correct: true,
      submittedAt: '2026-10-17T08:00:00.000Z',
    })
    expect(
      await service.dueQuestionIds(
        familyId,
        kidId,
        '2026-10-28T08:00:00.000Z',
      ),
    ).toEqual([questionId])

    await service.recordAnswer({
      familyId,
      kidId,
      kpId,
      questionId,
      submissionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      correct: true,
      submittedAt: '2026-10-28T08:00:00.000Z',
    })
    expect(
      await service.dueQuestionIds(
        familyId,
        kidId,
        '2026-11-13T08:00:00.000Z',
      ),
    ).toEqual([questionId])
  })
})
