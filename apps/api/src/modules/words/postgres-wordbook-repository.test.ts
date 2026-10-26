import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { PostgresWordbookRepository } from './postgres-wordbook-repository.js'
import { WordbookService } from './wordbook-service.js'

// Runs only against an explicitly supplied disposable PostgreSQL database.
const connection = process.env.WORDBOOK_TEST_DATABASE_URL
describe.skipIf(!connection)('PostgreSQL word answer transactions', () => {
  it('rolls back side-effect failure and serializes concurrent event replay', async () => {
    const pool = new Pool({ connectionString: connection! })
    const repository = new PostgresWordbookRepository(connection!)
    const service = new WordbookService(repository)
    const familyId = randomUUID()
    const createdBy = randomUUID()
    const kidId = randomUUID()
    try {
      await pool.query('insert into family(id,name) values($1,$2)', [familyId, 'transaction-test'])
      await pool.query(
        `insert into app_user(id,family_id,role,display_name) values($1,$3,'parent','parent'),($2,$3,'child','child')`,
        [createdBy, kidId, familyId],
      )
      const book = await service.import({
        familyId, createdBy, fileName: 'test.txt', sourceType: 'text',
        text: 'apple 苹果\nbanana 香蕉\ncat 猫\ndog 狗',
      })
      await service.confirm({ familyId, createdBy, id: book.id })
      const { quiz, questions } = await service.createQuiz({
        familyId, kidId, createdBy, wordbookId: book.id,
        direction: 'en_to_zh', count: 4, deliveryMode: 'passport',
      })
      const question = questions[0]!
      const input = {
        familyId, kidId, quizId: quiz.id,
        answers: [{
          questionId: question.id,
          selectedKey: question.answerKey === 'A' ? 'B' as const : 'A' as const,
          clientEventId: randomUUID(),
        }],
      }
      // Force the actual wrong-item INSERT to fail after the answer INSERT.
      await pool.query(`alter table word_wrong_item add constraint reject_test_family
        check (family_id <> '${familyId}'::uuid) not valid`)
      await expect(service.submitAnswers(input)).rejects.toThrow()
      expect(await repository.countAnswers(familyId, quiz.id)).toBe(0)
      expect((await service.getQuiz(familyId, quiz.id)).status).toBe('assigned')
      await pool.query('alter table word_wrong_item drop constraint reject_test_family')
      const retries = await Promise.all([1, 2, 3].map(() => service.submitAnswers(input)))
      expect(retries.reduce((n, item) => n + item.accepted.length, 0)).toBe(1)
      expect((await service.listWrongItems(familyId, kidId))[0]?.wrongCount).toBe(1)
      const other = questions[1]!
      await expect(service.submitAnswers({
        ...input, answers: [{ ...input.answers[0]!, questionId: other.id }],
      })).rejects.toThrow('WORD_ANSWER_EVENT_CONFLICT')
      expect(await repository.countAnswers(familyId, quiz.id)).toBe(1)
      const changed = await service.submitAnswers({
        ...input, answers: [{ questionId: question.id, selectedKey: question.answerKey }],
      })
      expect(changed.results[0]?.isCorrect).toBe(false)
      const finished = await service.submitAnswers({
        ...input, answers: questions.slice(1).map((item) => ({
          questionId: item.id, selectedKey: item.answerKey,
        })),
      })
      expect(finished.completed).toBe(true)
      expect((await service.getQuiz(familyId, quiz.id)).status).toBe('completed')
    } finally {
      await pool.query('alter table word_wrong_item drop constraint if exists reject_test_family')
      await pool.query('delete from family where id = $1', [familyId])
      await service.close()
      await pool.end()
    }
  })
})
