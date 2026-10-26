// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from './App.vue'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), getWordQuiz: vi.fn(), submitWordAnswers: vi.fn(),
  getWordbook: vi.fn(), updateWordbook: vi.fn(), confirmWordbook: vi.fn(),
}))
const quiz = vi.hoisted(() => ({
  id: 'quiz-ui', kidId: 'child', wordbookId: 'book-ui', direction: 'en_to_zh',
  deliveryMode: 'web', questionCount: 2, status: 'assigned', assignedLocalDate: '2026-10-26',
}))
const questions = ['q1', 'q2'].map((id, position) => ({
  id, position, stem: id,
  options: ['A', 'B', 'C', 'D'].map((key) => ({ key, text: `${key}-${id}` })),
}))
const book = vi.hoisted(() => ({
  id: 'book-ui', name: '校对词本', fileName: 'words.docx', sourceType: 'docx',
  status: 'ready_for_review', entryCount: 1,
}))
vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  ...mocks,
  getTodayTraining: vi.fn().mockResolvedValue({
    planId: 'plan', title: '今日训练', localDate: '2026-10-26', questions: [],
    budget: { elapsedSeconds: 0, sessionClosed: false, stopAddingQuestions: false },
  }),
  listWordQuizzes: vi.fn().mockResolvedValue([quiz]),
  getWordStats: vi.fn().mockResolvedValue({
    totalAnswers: 0, correctAnswers: 0, accuracy: 0, wrongItems: { active: 0, mastered: 0 },
  }),
  getWordWrongItems: vi.fn().mockResolvedValue([]),
  listWordbooks: vi.fn().mockResolvedValue([book]),
  getContent: vi.fn().mockResolvedValue({ chapters: [], knowledgePoints: [], questions: [], textbookImports: [] }),
  getTextbookImports: vi.fn().mockResolvedValue({ imports: [], chatConfigured: false }),
  getAssessments: vi.fn().mockResolvedValue({ assessments: [] }),
  getModelConfigs: vi.fn().mockResolvedValue({ capabilities: [] }),
  getTextbookProgress: vi.fn().mockResolvedValue(null),
}))
vi.mock('./offline/database', () => ({
  cacheChildWorkspace: vi.fn(), clearCachedChildWorkspace: vi.fn(), enqueueEvent: vi.fn(),
  getCachedChildWorkspace: vi.fn(), pendingCount: vi.fn().mockResolvedValue(0),
  findPendingAnswer: vi.fn(), enqueuePendingAnswer: vi.fn(),
}))
vi.mock('./offline/sync', () => ({
  syncOutbox: vi.fn(), syncPendingAnswers: vi.fn().mockResolvedValue({ resolved: [] }),
}))

let wrapper: VueWrapper | undefined
function button(label: string) {
  const match = wrapper!.findAll('button').find((item) => item.text().includes(label))
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.getSession.mockResolvedValue({ id: 'child', role: 'child' })
  mocks.getWordQuiz.mockResolvedValue({ quiz, questions, progress: [] })
  mocks.getWordbook.mockResolvedValue({
    ...book, entries: [{ word: 'apple', phonetic: '', partOfSpeech: 'n.', meaning: '苹果' }],
  })
})
afterEach(() => wrapper?.unmount())

async function enterWords() {
  wrapper = mount(App)
  await flushPromises()
  await button('单词').trigger('click')
  await flushPromises()
}

describe('word quiz interaction', () => {
  it('blocks incomplete submission, persists selections and restores them after reopening', async () => {
    await enterWords()
    await button('开始或继续作答').trigger('click')
    await flushPromises()
    await wrapper!.findAll('.word-options button')[1]!.trigger('click')
    expect(JSON.parse(localStorage.getItem('word-quiz:quiz-ui')!)).toEqual({ q1: 'B' })
    await button('下一题').trigger('click')
    expect(button('提交本轮').attributes('disabled')).toBeDefined()
    await wrapper!.findAll('.word-options button')[0]!.trigger('click')
    expect(button('提交本轮').attributes('disabled')).toBeUndefined()
    wrapper!.unmount()
    await enterWords()
    await button('开始或继续作答').trigger('click')
    await flushPromises()
    expect(wrapper!.find('.word-options button.selected').text()).toContain('B-q1')
    expect(wrapper!.text()).toContain('已选 2 题')
  })

  it('uses server progress over a stale draft, locks submitted answers and shows completion only on confirmation', async () => {
    localStorage.setItem('word-quiz:quiz-ui', JSON.stringify({ q1: 'A' }))
    mocks.getWordQuiz.mockResolvedValue({
      quiz, questions, progress: [{ questionId: 'q1', selectedKey: 'C', isCorrect: false }],
    })
    let resolve!: (value: unknown) => void
    mocks.submitWordAnswers.mockImplementation(() => new Promise((done) => { resolve = done }))
    await enterWords()
    await button('开始或继续作答').trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('第 2 / 2 题')
    await wrapper!.findAll('.word-options button')[0]!.trigger('click')
    await button('上一题').trigger('click')
    expect(wrapper!.find('.word-options button.selected').text()).toContain('C-q1')
    expect(wrapper!.findAll('.word-options button').every((item) => item.attributes('disabled') !== undefined)).toBe(true)
    await button('下一题').trigger('click')
    await button('提交本轮').trigger('click')
    expect(mocks.submitWordAnswers).toHaveBeenCalledWith('quiz-ui', [{ questionId: 'q2', selectedKey: 'A' }])
    expect(wrapper!.text()).not.toContain('本轮完成')
    expect(button('提交中').attributes('disabled')).toBeDefined()
    resolve({
      completed: true, answeredCount: 2,
      results: [{ questionId: 'q1', selectedKey: 'C', isCorrect: false }, { questionId: 'q2', selectedKey: 'A', isCorrect: true }],
    })
    await flushPromises()
    expect(wrapper!.text()).toContain('本轮完成')
    expect(wrapper!.text()).toContain('答对 1 / 2')
    expect(localStorage.getItem('word-quiz:quiz-ui')).toBeNull()
  })

  it('loads editable word entries and saves corrections before confirming', async () => {
    mocks.getSession.mockResolvedValue({ id: 'parent', role: 'parent' })
    mocks.updateWordbook.mockResolvedValue(book)
    mocks.confirmWordbook.mockResolvedValue({ ...book, status: 'confirmed' })
    await enterWords()
    expect(wrapper!.findAll('button').some((item) => item.text() === '保存并确认词本')).toBe(false)
    await button('预览并校对').trigger('click')
    await flushPromises()
    await wrapper!.find('textarea[aria-label="中文释义"]').setValue('苹果；苹果树')
    await button('保存并确认词本').trigger('click')
    await flushPromises()
    expect(mocks.updateWordbook).toHaveBeenCalledWith('book-ui', [
      { word: 'apple', phonetic: '', partOfSpeech: 'n.', meaning: '苹果；苹果树' },
    ])
    expect(mocks.confirmWordbook).toHaveBeenCalledWith('book-ui')
    expect(mocks.updateWordbook.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirmWordbook.mock.invocationCallOrder[0]!)
  })
})
