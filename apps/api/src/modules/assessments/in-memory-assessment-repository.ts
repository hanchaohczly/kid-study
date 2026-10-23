import type {
  Assessment,
  AssessmentRepository,
} from './assessment-service.js'

export class InMemoryAssessmentRepository implements AssessmentRepository {
  private readonly assessments = new Map<string, Assessment>()

  async save(assessment: Assessment): Promise<void> {
    this.assessments.set(assessment.id, structuredClone(assessment))
  }

  async list(familyId: string, kidId: string): Promise<Assessment[]> {
    return [...this.assessments.values()]
      .filter(
        (item) => item.familyId === familyId && item.kidId === kidId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((item) => structuredClone(item))
  }

  async listAssignedQuestionIds(
    familyId: string,
    kidId: string,
    localDate: string,
  ): Promise<string[]> {
    return [...this.assessments.values()]
      .filter(
        (item) =>
          item.familyId === familyId &&
          item.kidId === kidId &&
          item.status === 'assigned' &&
          localDateFor(item.assignedAt) === localDate,
      )
      .sort((left, right) => left.assignedAt.localeCompare(right.assignedAt))
      .flatMap((item) => item.questionIds)
  }

  async isQuestionAssigned(
    familyId: string,
    kidId: string,
    questionId: string,
  ): Promise<boolean> {
    return [...this.assessments.values()].some(
      (item) =>
        item.familyId === familyId &&
        item.kidId === kidId &&
        item.status === 'assigned' &&
        item.questionIds.includes(questionId),
    )
  }

  async close(): Promise<void> {}
}

function localDateFor(timestamp: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
}
