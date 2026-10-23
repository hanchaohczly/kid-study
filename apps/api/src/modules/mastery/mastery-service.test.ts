import { describe, expect, it } from 'vitest'
import type { KnowledgePoint } from '../content/content-repository.js'
import type { AnswerEvidence } from '../training/training-state-repository.js'
import { InMemoryMasteryRepository } from './mastery-repository.js'
import { calculateMasteryProjection } from './mastery-service.js'

const familyId = '11111111-1111-4111-8111-111111111111'
const kidId = '33333333-3333-4333-8333-333333333333'
const knowledgePoint: KnowledgePoint = {
  id: '20000000-0000-4000-8000-000000000001',
  familyId,
  code: 'M8-EQ-01',
  name: '一元一次方程',
  chapter: '第一章',
  summary: '',
  prerequisiteCodes: [],
  status: 'published',
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
}

describe('M0 mastery projection', () => {
  it('keeps the score hidden while evidence is insufficient', () => {
    const projection = calculateMasteryProjection(
      familyId,
      kidId,
      knowledgePoint,
      [evidence(1, true, 0, '2026-10-10T08:00:00.000Z')],
    )

    expect(projection).toMatchObject({
      status: 'insufficient',
      score: null,
      sampleCount: 1,
      independentCount: 1,
      spacedDayCount: 1,
    })
    expect(projection.calculationDetails.insufficiencyReasons).toEqual([
      'sample_count',
      'independent_count',
      'spaced_day_count',
      'speed_evidence',
    ])
  })

  it('marks repeated cross-day independent success as mastered', () => {
    const projection = calculateMasteryProjection(
      familyId,
      kidId,
      knowledgePoint,
      [
        evidence(1, true, 0, '2026-10-10T08:00:00.000Z'),
        evidence(2, true, 0, '2026-10-11T08:00:00.000Z'),
        evidence(3, true, 0, '2026-10-11T08:05:00.000Z'),
      ],
    )

    expect(projection).toMatchObject({
      status: 'mastered',
      score: 1,
      sampleCount: 3,
      independentCount: 3,
      independentCorrectCount: 3,
      spacedDayCount: 2,
    })
  })

  it('keeps wrong and hinted submissions in the denominator', () => {
    const projection = calculateMasteryProjection(
      familyId,
      kidId,
      knowledgePoint,
      [
        evidence(1, true, 0, '2026-10-10T08:00:00.000Z'),
        evidence(2, false, 0, '2026-10-10T08:02:00.000Z'),
        evidence(3, true, 3, '2026-10-11T08:00:00.000Z'),
      ],
    )

    expect(projection.status).toBe('weak')
    expect(projection.score).toBeCloseTo(0.45, 5)
    expect(projection.calculationDetails).toMatchObject({
      accuracy: 0.33333,
      hintDependence: 0.33333,
      averageHintLevel: 1,
      stability: 0,
      speed: 1,
      averageDurationMs: 120_000,
      latestIndependentCorrect: false,
    })
  })

  it('increments projection versions and rejects stale parent reviews', async () => {
    const repository = new InMemoryMasteryRepository()
    const firstInput = calculateMasteryProjection(
      familyId,
      kidId,
      knowledgePoint,
      [
        evidence(1, true, 0, '2026-10-10T08:00:00.000Z'),
        evidence(2, true, 0, '2026-10-11T08:00:00.000Z'),
        evidence(3, true, 0, '2026-10-11T08:05:00.000Z'),
      ],
    )
    const first = await repository.saveProjection(firstInput)
    const unchanged = await repository.saveProjection(firstInput)
    const second = await repository.saveProjection(
      calculateMasteryProjection(familyId, kidId, knowledgePoint, [
        evidence(1, true, 0, '2026-10-10T08:00:00.000Z'),
        evidence(2, true, 0, '2026-10-11T08:00:00.000Z'),
        evidence(3, true, 0, '2026-10-11T08:05:00.000Z'),
        evidence(4, false, 0, '2026-10-12T08:00:00.000Z'),
      ]),
    )

    expect(unchanged.projectionVersion).toBe(first.projectionVersion)
    expect(second.projectionVersion).toBe(first.projectionVersion + 1)
    await expect(
      repository.saveReview({
        familyId,
        projectionId: second.id,
        projectionVersion: first.projectionVersion,
        reviewerId: '22222222-2222-4222-8222-222222222222',
        decision: 'agree',
      }),
    ).rejects.toThrow('PROJECTION_CHANGED')
  })
})

function evidence(
  index: number,
  correct: boolean,
  hintLevel: 0 | 1 | 2 | 3,
  submittedAt: string,
): AnswerEvidence {
  const suffix = String(index).padStart(12, '0')
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
    attemptId: `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`,
    familyId,
    kidId,
    questionId: '10000000-0000-4000-8000-000000000001',
    kpId: knowledgePoint.id,
    correct,
    hintLevel,
    durationMs: 120_000,
    submittedAt,
  }
}
