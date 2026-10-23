import { describe, expect, it } from 'vitest'
import { contextForTest } from '../../app.js'
import { InMemoryContentRepository } from '../content/in-memory-content-repository.js'
import { InMemoryWrongBookRepository } from './wrong-book-repository.js'
import {
  WrongBookService,
  type PhotoWrongAnalyzer,
} from './wrong-book-service.js'

const familyId = '11111111-1111-4111-8111-111111111111'
const kidId = '33333333-3333-4333-8333-333333333333'
const kpId = '20000000-0000-4000-8000-000000000001'
const questionId = '10000000-0000-4000-8000-000000000001'

describe('WrongBookService', () => {
  function createService(analyzer: PhotoWrongAnalyzer = photoAnalyzer) {
    const content = new InMemoryContentRepository({ seedDemoContent: true })
    const repository = new InMemoryWrongBookRepository()
    return {
      content,
      repository,
      service: new WrongBookService(
        repository,
        content,
        analyzer,
        () => new Date('2026-10-12T12:00:00.000Z'),
      ),
    }
  }

  it('captures system mistakes idempotently and counts distinct submissions', async () => {
    const { service, content } = createService()
    const question = await content.findPublishedQuestion(familyId, questionId)
    const privateQuestion = await content.findQuestionPrivate(
      familyId,
      questionId,
    )
    const base = {
      familyId,
      kidId,
      question: question!,
      privateQuestion: privateQuestion!,
      studentAnswer: 'A',
      occurredAt: '2026-10-12T10:00:00.000Z',
    }

    await service.captureSystemWrong({
      ...base,
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
    await service.captureSystemWrong({
      ...base,
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
    await service.captureSystemWrong({
      ...base,
      submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      occurredAt: '2026-10-12T11:00:00.000Z',
    })

    const result = await service.list(contextForTest())
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      source: 'system',
      kpId,
      wrongCount: 2,
      latestWrongAt: '2026-10-12T11:00:00.000Z',
    })
    expect(result.items[0]).not.toHaveProperty('answerKey')
    expect(result.items[0]).not.toHaveProperty('analysis')
  })

  it('recognizes a photo, keeps the original image and supports parent management', async () => {
    const { service } = createService()
    const parent = contextForTest({
      role: 'parent',
      userId: '22222222-2222-4222-8222-222222222222',
      deviceId: '44444444-4444-4444-8444-444444444444',
    })
    const data = Buffer.from('test-image')
    const created = await service.createFromPhoto(parent, {
      mimeType: 'image/png',
      data,
    })

    expect(created).toMatchObject({
      source: 'photo',
      kpId,
      knowledgePointName: '一元一次方程',
      mappingConfidence: 0.91,
      mappingConfirmed: false,
      hasPhoto: true,
    })
    await expect(service.getPhoto(parent, created.id)).resolves.toMatchObject({
      mimeType: 'image/png',
      data,
    })

    const updated = await service.update(parent, created.id, {
      status: 'archived',
      tags: ['计算', '计算', ' 复习 '],
      note: '周末再看',
      kpId,
    })
    expect(updated).toMatchObject({
      status: 'archived',
      tags: ['计算', '复习'],
      note: '周末再看',
      mappingMethod: 'manual',
      mappingConfirmed: true,
    })
  })

  it('marks an item mastered after two consecutive successful reviews', async () => {
    const { service } = createService()
    const parent = contextForTest({
      role: 'parent',
      userId: '22222222-2222-4222-8222-222222222222',
    })
    const created = await service.createFromPhoto(parent, {
      mimeType: 'image/jpeg',
      data: Buffer.from('test-image'),
    })

    await service.recordReview(contextForTest(), created.id, 'correct')
    const mastered = await service.recordReview(
      contextForTest(),
      created.id,
      'correct',
    )

    expect(mastered).toMatchObject({
      status: 'mastered',
      reviewCount: 2,
      correctReviewStreak: 2,
    })
  })
})

const photoAnalyzer: PhotoWrongAnalyzer = {
  isConfigured: () => true,
  async analyze() {
    return {
      stem: '解方程 3x + 5 = 20。',
      studentAnswer: 'x = 5',
      answerKey: 'x = 5',
      analysis: '应先使用等式基本性质。',
      kpId,
      mappingConfidence: 0.91,
    }
  },
}
