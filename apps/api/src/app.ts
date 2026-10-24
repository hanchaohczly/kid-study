import Fastify, {
  type FastifyInstance,
  type FastifyReply,
} from 'fastify'
import multipart from '@fastify/multipart'
import {
  eventBatchInputSchema,
  type RequestContext,
} from '@kid-study/contracts'
import { z } from 'zod'
import { authenticate, registerAuth } from './auth.js'
import { loadConfig, type AppConfig } from './config.js'
import type { ContentRepository } from './modules/content/content-repository.js'
import { InMemoryContentRepository } from './modules/content/in-memory-content-repository.js'
import { PostgresContentRepository } from './modules/content/postgres-content-repository.js'
import { EventService } from './modules/events/event-service.js'
import type { EventRepository } from './modules/events/event-repository.js'
import { InMemoryEventRepository } from './modules/events/in-memory-event-repository.js'
import { PostgresEventRepository } from './modules/events/postgres-event-repository.js'
import {
  OpenAiCompatibleSubjectiveAnswerGrader,
  TrainingService,
  type SubjectiveAnswerGrader,
} from './modules/training/training-service.js'
import {
  AssessmentService,
  OpenAiCompatibleQuestionGenerator,
  type AssessmentRepository,
  type QuestionGenerator,
} from './modules/assessments/assessment-service.js'
import { InMemoryAssessmentRepository } from './modules/assessments/in-memory-assessment-repository.js'
import { PostgresAssessmentRepository } from './modules/assessments/postgres-assessment-repository.js'
import { RoutineAssessmentScheduler } from './modules/assessments/routine-scheduler.js'
import {
  InMemoryTextbookImportRepository,
  OpenAiCompatibleTextbookAnalyzer,
  PdfParseTextExtractor,
  TextbookImportService,
} from './modules/textbooks/textbook-import-service.js'
import { PostgresTextbookImportRepository } from './modules/textbooks/postgres-textbook-import-repository.js'
import {
  WordbookService,
  wordbookDraftSchema,
} from './modules/words/wordbook-service.js'
import { InMemoryWordbookRepository } from './modules/words/in-memory-wordbook-repository.js'
import { PostgresWordbookRepository } from './modules/words/postgres-wordbook-repository.js'
import { DocxTextExtractor } from './modules/words/docx-text-extractor.js'
import {
  ModelConfigService,
  SecretCipher,
  type ModelCapability,
  type ModelConfigRepository,
} from './modules/models/model-config-service.js'
import { FileModelConfigRepository } from './modules/models/file-model-config-repository.js'
import { PostgresModelConfigRepository } from './modules/models/postgres-model-config-repository.js'
import { ModelRouter } from './modules/models/model-router.js'
import {
  GuideService,
  InMemoryGuideAuditRepository,
  OpenAiCompatibleGuideGenerator,
  OpenAiCompatibleGuideSemanticChecker,
  PostgresGuideAuditRepository,
} from './modules/guide/guide-service.js'
import {
  InMemoryTrainingStateRepository,
  PostgresTrainingStateRepository,
} from './modules/training/training-state-repository.js'
import {
  InMemoryMasteryRepository,
  PostgresMasteryRepository,
} from './modules/mastery/mastery-repository.js'
import { MasteryService } from './modules/mastery/mastery-service.js'
import {
  InMemoryWrongBookRepository,
  PostgresWrongBookRepository,
  type WrongBookRepository,
} from './modules/wrong-book/wrong-book-repository.js'
import {
  OpenAiCompatiblePhotoWrongAnalyzer,
  WrongBookService,
  type PhotoWrongAnalyzer,
} from './modules/wrong-book/wrong-book-service.js'
import {
  InMemoryPlanningRepository,
  PostgresPlanningRepository,
  type PlanningRepository,
} from './modules/planning/planning-repository.js'
import { PlanningService } from './modules/planning/planning-service.js'
import { registerMetrics } from './metrics.js'

interface BuildAppOptions {
  config?: AppConfig
  eventRepository?: EventRepository
  contentRepository?: ContentRepository
  textbookImportService?: TextbookImportService
  assessmentRepository?: AssessmentRepository
  questionGenerator?: QuestionGenerator
  subjectiveAnswerGrader?: SubjectiveAnswerGrader
  wrongBookRepository?: WrongBookRepository
  photoWrongAnalyzer?: PhotoWrongAnalyzer
  planningRepository?: PlanningRepository
  wordbookService?: WordbookService
  modelConfigRepository?: ModelConfigRepository
  logger?: boolean
  startSchedulers?: boolean
}

const demoFamilyId = '11111111-1111-4111-8111-111111111111'
const modelCapabilitySchema = z.enum(['chat', 'embedding', 'vision'])

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig()
  const app = Fastify({
    trustProxy: true,
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.credential',
                'req.body.apiKey',
                'req.body.primary.apiKey',
                'req.body.fallback.apiKey',
                'req.body.events[*].payload.kidInput',
              ],
              censor: '[REDACTED]',
            },
          },
    bodyLimit: 256 * 1024,
    requestIdHeader: 'x-request-id',
  })

  const eventRepository =
    options.eventRepository ??
    (config.databaseUrl
      ? new PostgresEventRepository(config.databaseUrl)
      : new InMemoryEventRepository())
  const eventService = new EventService(eventRepository)
  const contentRepository =
    options.contentRepository ??
    (config.databaseUrl
      ? new PostgresContentRepository(config.databaseUrl)
      : new InMemoryContentRepository())
  const modelConfigRepository =
    options.modelConfigRepository ??
    (config.databaseUrl
      ? new PostgresModelConfigRepository(config.databaseUrl)
      : new FileModelConfigRepository(config.modelConfigFile))
  const environmentChat =
    config.llmApiUrl && config.llmApiKey && config.llmModel
      ? {
          capability: 'chat' as const,
          enabled: true,
          primary: {
            baseUrl: config.llmApiUrl,
            apiKey: config.llmApiKey,
            model: config.llmModel,
          },
          retryCount: 2,
          timeoutMs: 90_000,
          updatedAt: new Date(0).toISOString(),
        }
      : undefined
  const modelConfigService = new ModelConfigService(
    modelConfigRepository,
    new SecretCipher(config.modelConfigEncryptionKey),
    environmentChat,
  )
  await modelConfigService.initialize(demoFamilyId)
  const modelRouter = new ModelRouter(modelConfigService)
  const assessmentRepository =
    options.assessmentRepository ??
    (config.databaseUrl
      ? new PostgresAssessmentRepository(config.databaseUrl)
      : new InMemoryAssessmentRepository())
  const questionGenerator =
    options.questionGenerator ??
    new OpenAiCompatibleQuestionGenerator(modelRouter)
  const assessmentService = new AssessmentService(
    contentRepository,
    eventRepository,
    assessmentRepository,
    questionGenerator,
  )
  const trainingStateRepository = config.databaseUrl
    ? new PostgresTrainingStateRepository(config.databaseUrl)
    : new InMemoryTrainingStateRepository()
  const guideAuditRepository = config.databaseUrl
    ? new PostgresGuideAuditRepository(config.databaseUrl)
    : new InMemoryGuideAuditRepository()
  const guideService = new GuideService(
    new OpenAiCompatibleGuideGenerator(modelRouter),
    guideAuditRepository,
    undefined,
    new OpenAiCompatibleGuideSemanticChecker(modelRouter),
  )
  const wrongBookRepository =
    options.wrongBookRepository ??
    (config.databaseUrl
      ? new PostgresWrongBookRepository(config.databaseUrl)
      : new InMemoryWrongBookRepository())
  const wrongBookService = new WrongBookService(
    wrongBookRepository,
    contentRepository,
    options.photoWrongAnalyzer ??
      new OpenAiCompatiblePhotoWrongAnalyzer(modelRouter),
  )
  const planningService = new PlanningService(
    options.planningRepository ??
      (config.databaseUrl
        ? new PostgresPlanningRepository(config.databaseUrl)
        : new InMemoryPlanningRepository()),
    contentRepository,
  )
  const trainingService = new TrainingService(
    contentRepository,
    contentRepository,
    assessmentRepository,
    trainingStateRepository,
    guideService,
    undefined,
    options.subjectiveAnswerGrader ??
      new OpenAiCompatibleSubjectiveAnswerGrader(modelRouter),
    wrongBookService,
    planningService,
  )
  const routineScheduler = new RoutineAssessmentScheduler(
    assessmentService,
    planningService,
    undefined,
    (error) => app.log.error({ err: error }, 'routine assessment failed'),
  )
  const masteryService = new MasteryService(
    contentRepository,
    trainingStateRepository,
    config.databaseUrl
      ? new PostgresMasteryRepository(config.databaseUrl)
      : new InMemoryMasteryRepository(),
  )
  const textbookImportService =
    options.textbookImportService ??
    new TextbookImportService(
      contentRepository,
      new PdfParseTextExtractor(),
      new OpenAiCompatibleTextbookAnalyzer(modelRouter),
      config.databaseUrl
        ? new PostgresTextbookImportRepository(config.databaseUrl)
        : new InMemoryTextbookImportRepository(),
    )
  const wordbookService =
    options.wordbookService ??
    new WordbookService(
      config.databaseUrl
        ? new PostgresWordbookRepository(config.databaseUrl)
        : new InMemoryWordbookRepository(),
    )
  const pdfTextExtractor = new PdfParseTextExtractor()
  const docxTextExtractor = new DocxTextExtractor()

  await registerAuth(app, config)
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 30 * 1024 * 1024,
    },
  })

  registerMetrics(app)
  app.get(
    '/health/live',
    { config: { rateLimit: false } },
    async () => ({ status: 'ok' }),
  )
  app.get(
    '/health/ready',
    { config: { rateLimit: false } },
    async () => ({
      status: 'ready',
      storage: config.databaseUrl ? 'postgres' : 'memory',
      modelConfigStorage: config.databaseUrl ? 'postgres' : 'file',
    }),
  )

  app.get(
    '/v1/session',
    { preHandler: authenticate },
    async (request) => ({
      user: {
        id: request.authContext.userId,
        role: request.authContext.role,
        kidId: request.authContext.kidId,
      },
    }),
  )

  app.get(
    '/v1/model-configs',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      return {
        capabilities: await modelConfigService.listPublic(
          request.authContext.familyId,
        ),
        usage: {
          chat: ['教材结构化', '动态出题', '分步引导'],
          embedding: ['教材语义检索', '知识点匹配', '相似错题检索'],
          vision: ['扫描教材识别', '作业图片识别', '数学公式识别'],
        },
      }
    },
  )

  app.put(
    '/v1/model-configs/:capability',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z
        .object({ capability: modelCapabilitySchema })
        .safeParse(request.params)
      const endpointSchema = z.object({
        baseUrl: z
          .url()
          .max(500)
          .refine(
            (value) =>
              value.startsWith('https://') || value.startsWith('http://'),
            '只支持 HTTP/HTTPS 地址',
          ),
        model: z.string().trim().min(1).max(160),
        apiKey: z.string().trim().max(500).optional(),
      })
      const body = z
        .object({
          enabled: z.boolean(),
          primary: endpointSchema,
          fallback: endpointSchema.optional(),
          retryCount: z.number().int().min(0).max(5),
          timeoutMs: z.number().int().min(5_000).max(300_000),
        })
        .safeParse(request.body)
      if (!params.success || !body.success) {
        return invalidContent(reply, request.id, [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
        ])
      }
      try {
        const capability = await modelConfigService.save(
          request.authContext.familyId,
          params.data.capability as ModelCapability,
          {
            enabled: body.data.enabled,
            primary: {
              baseUrl: body.data.primary.baseUrl,
              model: body.data.primary.model,
              ...(body.data.primary.apiKey
                ? { apiKey: body.data.primary.apiKey }
                : {}),
            },
            ...(body.data.fallback
              ? {
                  fallback: {
                    baseUrl: body.data.fallback.baseUrl,
                    model: body.data.fallback.model,
                    ...(body.data.fallback.apiKey
                      ? { apiKey: body.data.fallback.apiKey }
                      : {}),
                  },
                }
              : {}),
            retryCount: body.data.retryCount,
            timeoutMs: body.data.timeoutMs,
          },
        )
        return { capability }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'MODEL_API_KEY_REQUIRED' ||
            error.message === 'FALLBACK_API_KEY_REQUIRED')
        ) {
          return reply.code(400).send({
            code: error.message,
            message:
              error.message === 'MODEL_API_KEY_REQUIRED'
                ? '首次启用主模型时必须填写 API Key'
                : '启用回退模型时必须填写 API Key',
            requestId: request.id,
            retryable: false,
          })
        }
        throw error
      }
    },
  )

  app.post(
    '/v1/model-configs/:capability/models',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z
        .object({ capability: modelCapabilitySchema })
        .safeParse(request.params)
      const body = z
        .object({
          target: z.enum(['primary', 'fallback']),
          baseUrl: z
            .url()
            .max(500)
            .refine(
              (value) =>
                value.startsWith('https://') || value.startsWith('http://'),
              '只支持 HTTP/HTTPS 地址',
            ),
          apiKey: z.string().trim().max(500).optional(),
        })
        .safeParse(request.body)
      if (!params.success || !body.success) {
        return invalidContent(reply, request.id, [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
        ])
      }

      try {
        const models = await modelRouter.listModels(
          request.authContext.familyId,
          params.data.capability,
          body.data.target,
          {
            baseUrl: body.data.baseUrl,
            ...(body.data.apiKey ? { apiKey: body.data.apiKey } : {}),
          },
        )
        return { models }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'MODEL_LIST_FAILED'
        if (message === 'MODEL_API_KEY_REQUIRED') {
          return reply.code(400).send({
            code: message,
            message: '请填写 API Key；仅地址未变化时可复用已保存密钥',
            requestId: request.id,
            retryable: false,
          })
        }
        return reply.code(502).send({
          code: 'MODEL_LIST_FAILED',
          message: `获取模型列表失败：${message}`,
          requestId: request.id,
          retryable: false,
        })
      }
    },
  )

  app.post(
    '/v1/model-configs/:capability/test',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z
        .object({ capability: modelCapabilitySchema })
        .safeParse(request.params)
      if (!params.success) return notFound(reply, request.id)

      const startedAt = Date.now()
      try {
        if (params.data.capability === 'embedding') {
          const result = await modelRouter.embed(request.authContext.familyId, {
            input: '一元一次方程的等式基本性质',
          })
          return {
            ok: true,
            capability: params.data.capability,
            model: result.model,
            attempts: result.attempts,
            usedFallback: result.usedFallback,
            latencyMs: Date.now() - startedAt,
            dimensions: result.data[0]?.length ?? 0,
          }
        }
        if (params.data.capability === 'chat') {
          const result = await modelRouter.chatJson<{ status?: string }>(
            request.authContext.familyId,
            {
              temperature: 0,
              messages: [
                {
                  role: 'system',
                  content: '只返回 JSON 对象：{"status":"ok"}',
                },
                { role: 'user', content: '执行连通性测试。' },
              ],
            },
          )
          if (result.data.status !== 'ok') {
            throw new Error('MODEL_TEST_UNEXPECTED_RESPONSE')
          }
          return {
            ok: true,
            capability: params.data.capability,
            model: result.model,
            attempts: result.attempts,
            usedFallback: result.usedFallback,
            latencyMs: Date.now() - startedAt,
          }
        }
        return reply.code(400).send({
          code: 'VISION_TEST_IMAGE_REQUIRED',
          message: 'Vision 连通性测试需要上传一张测试图片',
          requestId: request.id,
          retryable: false,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'MODEL_TEST_FAILED'
        return reply.code(message === 'LLM_NOT_CONFIGURED' ? 409 : 502).send({
          code:
            message === 'LLM_NOT_CONFIGURED'
              ? 'MODEL_NOT_ENABLED'
              : 'MODEL_TEST_FAILED',
          message:
            message === 'LLM_NOT_CONFIGURED'
              ? '该模型能力尚未启用'
              : `模型连通性测试失败：${message}`,
          requestId: request.id,
          retryable: false,
        })
      }
    },
  )

  app.get(
    '/v1/textbooks',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      return {
        configured: textbookImportService.isConfigured(
          request.authContext.familyId,
        ),
        requiredCapability: 'chat',
        imports: await textbookImportService.list(request.authContext.familyId),
      }
    },
  )

  app.get(
    '/v1/textbooks/progress',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      return {
        progress:
          textbookImportService.getProgress(request.authContext.familyId) ??
          null,
      }
    },
  )

  app.post(
    '/v1/textbooks/upload',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      if (!textbookImportService.isConfigured(request.authContext.familyId)) {
        return reply.code(409).send({
          code: 'CHAT_MODEL_NOT_CONFIGURED',
          message:
            '教材自动梳理需要 Chat 模型；Embedding 模型仅用于语义检索，请先在“模型配置 > Chat”中启用主模型',
          requestId: request.id,
          retryable: false,
        })
      }

      const file = await request.file()
      if (!file || file.mimetype !== 'application/pdf') {
        return reply.code(400).send({
          code: 'INVALID_PDF',
          message: '请选择 PDF 文件',
          requestId: request.id,
          retryable: false,
        })
      }
      try {
        const imported = await textbookImportService.upload(
          request.authContext.familyId,
          file.filename,
          await file.toBuffer(),
        )
        return reply.code(201).send({ textbookImport: imported })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(422).send({
            code: 'LLM_INVALID_TEXTBOOK_STRUCTURE',
            message: '大模型返回的教材结构不完整，请重试或更换 Chat 模型',
            requestId: request.id,
            retryable: true,
          })
        }
        if (error instanceof Error) {
          const known: Record<
            string,
            { status: number; message: string; retryable: boolean }
          > = {
            INVALID_PDF: {
              status: 422,
              message: '文件不是有效的 PDF',
              retryable: false,
            },
            PDF_TEXT_LAYER_REQUIRED: {
              status: 422,
              message: '教材没有可提取文本，请提供原生电子版 PDF',
              retryable: false,
            },
            LLM_EMPTY_RESPONSE: {
              status: 502,
              message: '大模型未返回结构化结果，请重试或更换 Chat 模型',
              retryable: true,
            },
            LLM_NOT_CONFIGURED: {
              status: 409,
              message:
                '教材自动梳理需要 Chat 模型；请先在“模型配置 > Chat”中启用主模型',
              retryable: false,
            },
            TEXTBOOK_IMPORT_IN_PROGRESS: {
              status: 409,
              message: '已有教材正在梳理，请等待当前任务完成',
              retryable: false,
            },
          }
          const mapped = known[error.message]
          if (mapped) {
            return reply.code(mapped.status).send({
              code: error.message,
              message: mapped.message,
              requestId: request.id,
              retryable: mapped.retryable,
            })
          }
          if (
            error.name === 'TimeoutError' ||
            error.message.startsWith('LLM_REQUEST_FAILED:')
          ) {
            return reply.code(502).send({
              code: 'LLM_TEXTBOOK_ANALYSIS_FAILED',
              message: '教材分析模型请求失败或超时，请重试或调整 Chat 模型配置',
              requestId: request.id,
              retryable: true,
            })
          }
        }
        throw error
      }
    },
  )

  app.get(
    '/v1/textbooks/:id/parse-status',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      if (!params.success) return notFound(reply, request.id)
      const item = await textbookImportService.get(
        request.authContext.familyId,
        params.data.id,
      )
      return item
        ? {
            id: item.id,
            status: item.status,
            pageCount: item.pageCount,
            extractedCharacters: item.extractedCharacters,
          }
        : notFound(reply, request.id)
    },
  )

  app.get(
    '/v1/textbooks/:id/draft',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      if (!params.success) return notFound(reply, request.id)
      const item = await textbookImportService.get(
        request.authContext.familyId,
        params.data.id,
      )
      return item ? { textbookImport: item } : notFound(reply, request.id)
    },
  )

  app.post(
    '/v1/textbooks/:id/validate',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      if (!params.success) return notFound(reply, request.id)
      try {
        const item = await textbookImportService.confirm(
          request.authContext.familyId,
          params.data.id,
        )
        return { textbookImport: item }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'TEXTBOOK_IMPORT_NOT_FOUND'
        ) {
          return notFound(reply, request.id)
        }
        throw error
      }
    },
  )

  app.get(
    '/v1/content',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const knowledgePoints = await contentRepository.listKnowledgePoints(
        request.authContext.familyId,
      )
      return {
        knowledgePoints,
        assessmentConfigured: assessmentService.isConfigured(
          request.authContext.familyId,
        ),
      }
    },
  )

  app.get(
    '/v1/tasks',
    { preHandler: authenticate },
    async (request) => planningService.listTasks(request.authContext),
  )

  app.post(
    '/v1/tasks',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const body = z
        .object({
          source: z.enum(['parent', 'school']).default('parent'),
          kind: z.enum([
            'homework',
            'preview',
            'review',
            'carry_reminder',
            'practice',
          ]),
          title: z.string().trim().min(1).max(160),
          description: z.string().trim().max(2_000).default(''),
          subject: z.string().trim().min(1).max(80),
          kpId: z.uuid().optional(),
          dueAt: z.iso.datetime().optional(),
          estimatedMinutes: z.number().int().min(1).max(180).default(10),
          priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
        })
        .safeParse(request.body)
      if (!body.success) {
        return invalidContent(reply, request.id, body.error.issues)
      }
      try {
        const task = await planningService.createTask(
          request.authContext,
          {
            source: body.data.source,
            kind: body.data.kind,
            title: body.data.title,
            description: body.data.description,
            subject: body.data.subject,
            ...(body.data.kpId ? { kpId: body.data.kpId } : {}),
            ...(body.data.dueAt ? { dueAt: body.data.dueAt } : {}),
            estimatedMinutes: body.data.estimatedMinutes,
            priority: body.data.priority,
          },
        )
        return reply.code(201).send({ task })
      } catch (error) {
        return planningError(error, reply, request.id)
      }
    },
  )

  app.patch(
    '/v1/tasks/:id/status',
    { preHandler: authenticate },
    async (request, reply) => {
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      const body = z
        .object({
          status: z.enum(['pending', 'claimed_done', 'verified', 'cancelled']),
        })
        .safeParse(request.body)
      if (!params.success || !body.success) {
        return invalidContent(reply, request.id, [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
        ])
      }
      try {
        return {
          task: await planningService.changeTaskStatus(
            request.authContext,
            params.data.id,
            body.data.status,
          ),
        }
      } catch (error) {
        return planningError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/curriculum-progress',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      return {
        progress: await planningService.listProgress(request.authContext),
      }
    },
  )

  app.post(
    '/v1/curriculum-progress',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const body = z
        .object({
          subject: z.string().trim().min(1).max(80),
          chapter: z.string().trim().min(1).max(300),
          kpId: z.uuid().optional(),
          source: z
            .enum(['parent', 'schedule_ocr', 'school_task_ocr'])
            .default('parent'),
          confidence: z.number().min(0).max(1).default(1),
          effectiveDate: z.iso.date(),
        })
        .safeParse(request.body)
      if (!body.success) {
        return invalidContent(reply, request.id, body.error.issues)
      }
      try {
        return reply.code(201).send({
          progress: await planningService.createProgress(
            request.authContext,
            {
              subject: body.data.subject,
              chapter: body.data.chapter,
              ...(body.data.kpId ? { kpId: body.data.kpId } : {}),
              source: body.data.source,
              confidence: body.data.confidence,
              effectiveDate: body.data.effectiveDate,
            },
          ),
        })
      } catch (error) {
        return planningError(error, reply, request.id)
      }
    },
  )

  app.post(
    '/v1/curriculum-progress/:id/confirm',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      const body = z.object({ kpId: z.uuid() }).safeParse(request.body)
      if (!params.success || !body.success) {
        return invalidContent(reply, request.id, [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
        ])
      }
      try {
        return {
          progress: await planningService.confirmProgress(
            request.authContext,
            params.data.id,
            body.data.kpId,
          ),
        }
      } catch (error) {
        return planningError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/reviews/due',
    { preHandler: authenticate },
    async (request) => ({
      reviews: await planningService.listDueReviews(request.authContext),
    }),
  )

  app.get(
    '/v1/assessments',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent' || !request.authContext.kidId) {
        return notFound(reply, request.id)
      }
      return {
        configured: assessmentService.isConfigured(
          request.authContext.familyId,
        ),
        assessments: await assessmentService.list(
          request.authContext.familyId,
          request.authContext.kidId,
        ),
      }
    },
  )

  app.post(
    '/v1/assessments',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent' || !request.authContext.kidId) {
        return notFound(reply, request.id)
      }
      const parsed = z
        .object({
          knowledgePointIds: z.array(z.uuid()).min(1).max(20),
          purpose: z.string().trim().min(2).max(200),
          count: z.number().int().min(1).max(8).default(3),
          deliveryMode: z
            .enum(['passport', 'weekend_paper'])
            .default('passport'),
          selectionMode: z.enum(['manual', 'auto_core']).default('manual'),
        })
        .safeParse(request.body)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      try {
        const assessment = await assessmentService.createParentInitiated({
          familyId: request.authContext.familyId,
          kidId: request.authContext.kidId,
          createdBy: request.authContext.userId,
          ...parsed.data,
        })
        return reply.code(201).send({ assessment })
      } catch (error) {
        return assessmentError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/assessments/recommendations',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent' || !request.authContext.kidId) {
        return notFound(reply, request.id)
      }
      const parsed = z
        .object({ count: z.coerce.number().int().min(1).max(20).default(6) })
        .safeParse(request.query)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      return {
        recommendations: await assessmentService.recommendKnowledgePoints(
          request.authContext.familyId,
          request.authContext.kidId,
          parsed.data.count,
        ),
      }
    },
  )

  app.post(
    '/v1/assessments/routine',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent' || !request.authContext.kidId) {
        return notFound(reply, request.id)
      }
      const parsed = z
        .object({ count: z.number().int().min(1).max(5).default(3) })
        .safeParse(request.body)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      try {
        const assessment = await assessmentService.createRoutine({
          familyId: request.authContext.familyId,
          kidId: request.authContext.kidId,
          createdBy: request.authContext.userId,
          count: parsed.data.count,
        })
        return reply.code(201).send({ assessment })
      } catch (error) {
        return assessmentError(error, reply, request.id)
      }
    },
  )

  app.post(
    '/v1/wordbooks/upload',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const file = await request.file()
      if (!file) {
        return reply.code(400).send({
          code: 'INVALID_WORDBOOK_FILE',
          message: '请选择单词本文件（PDF 或 Word .docx）',
          requestId: request.id,
          retryable: false,
        })
      }
      const fileName = file.filename ?? ''
      const lower = fileName.toLowerCase()
      if (lower.endsWith('.doc')) {
        return reply.code(400).send({
          code: 'INVALID_WORDBOOK_FILE',
          message: '不支持旧版 .doc，请另存为 .docx 后再上传',
          requestId: request.id,
          retryable: false,
        })
      }
      const isPdf =
        file.mimetype === 'application/pdf' || lower.endsWith('.pdf')
      const isDocx =
        file.mimetype ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lower.endsWith('.docx')
      if (!isPdf && !isDocx) {
        return reply.code(400).send({
          code: 'INVALID_WORDBOOK_FILE',
          message: '仅支持 PDF 或 Word（.docx）文件',
          requestId: request.id,
          retryable: false,
        })
      }
      try {
        const buffer = await file.toBuffer()
        let text = ''
        if (isPdf) {
          try {
            text = (await pdfTextExtractor.extract(buffer)).text
          } catch {
            throw new Error('INVALID_PDF')
          }
        } else {
          text = await docxTextExtractor.extract(buffer)
        }
        const wordbook = await wordbookService.import({
          familyId: request.authContext.familyId,
          createdBy: request.authContext.userId,
          fileName,
          sourceType: isPdf ? 'pdf' : 'docx',
          text,
        })
        return reply.code(201).send({ wordbook })
      } catch (error) {
        return wordbookError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/wordbooks',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const wordbooks = await wordbookService.list(request.authContext.familyId)
      return {
        // 列表只返回概况，词条明细走 /v1/wordbooks/:id
        wordbooks: wordbooks.map((wordbook) => ({
          ...wordbook,
          entries: undefined,
        })),
      }
    },
  )

  app.get(
    '/v1/wordbooks/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const parsed = z.object({ id: z.uuid() }).safeParse(request.params)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      const wordbook = await wordbookService.get(
        request.authContext.familyId,
        parsed.data.id,
      )
      if (!wordbook) return notFound(reply, request.id)
      return { wordbook }
    },
  )

  app.patch(
    '/v1/wordbooks/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      const body = z
        .object({ entries: wordbookDraftSchema.shape.entries })
        .safeParse(request.body)
      if (!params.success) {
        return invalidContent(reply, request.id, params.error.issues)
      }
      if (!body.success) {
        return invalidContent(reply, request.id, body.error.issues)
      }
      try {
        const wordbook = await wordbookService.updateDraft({
          familyId: request.authContext.familyId,
          id: params.data.id,
          entries: body.data.entries,
        })
        return { wordbook }
      } catch (error) {
        return wordbookError(error, reply, request.id)
      }
    },
  )

  app.post(
    '/v1/wordbooks/:id/confirm',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const parsed = z.object({ id: z.uuid() }).safeParse(request.params)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      try {
        const wordbook = await wordbookService.confirm({
          familyId: request.authContext.familyId,
          id: parsed.data.id,
          createdBy: request.authContext.userId,
        })
        return { wordbook }
      } catch (error) {
        return wordbookError(error, reply, request.id)
      }
    },
  )

  app.delete(
    '/v1/wordbooks/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const parsed = z.object({ id: z.uuid() }).safeParse(request.params)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      await wordbookService.remove(
        request.authContext.familyId,
        parsed.data.id,
      )
      return reply.code(204).send()
    },
  )

  app.post(
    '/v1/word-quizzes',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent' || !request.authContext.kidId) {
        return notFound(reply, request.id)
      }
      const parsed = z
        .object({
          wordbookId: z.uuid(),
          direction: z.enum(['en_to_zh', 'zh_to_en']),
          count: z.number().int().min(1).max(50).default(10),
          deliveryMode: z.enum(['passport', 'web']).default('passport'),
        })
        .safeParse(request.body)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      try {
        const { quiz, questions } = await wordbookService.createQuiz({
          familyId: request.authContext.familyId,
          kidId: request.authContext.kidId,
          createdBy: request.authContext.userId,
          ...parsed.data,
        })
        return reply.code(201).send({
          quiz,
          questionCount: questions.length,
        })
      } catch (error) {
        return wordbookError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/word-quizzes',
    { preHandler: authenticate },
    async (request, reply) => {
      const kidId = request.authContext.kidId
      if (!kidId) return notFound(reply, request.id)
      const parsed = z
        .object({ limit: z.coerce.number().int().min(1).max(50).default(10) })
        .safeParse(request.query)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      return {
        quizzes: await wordbookService.listQuizzes(
          request.authContext.familyId,
          kidId,
          parsed.data.limit,
        ),
      }
    },
  )

  app.get(
    '/v1/word-quizzes/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      if (!params.success) {
        return invalidContent(reply, request.id, params.error.issues)
      }
      try {
        const quiz = await wordbookService.getQuiz(
          request.authContext.familyId,
          params.data.id,
          request.authContext.kidId,
        )
        const questions = await wordbookService.listQuizQuestions(
          request.authContext.familyId,
          quiz.id,
        )
        // 随身设备离线作答时需要答案，仅 passport 模式返回
        const withAnswers = quiz.deliveryMode === 'passport'
        return {
          quiz,
          questions: questions.map((question) => ({
            id: question.id,
            position: question.position,
            stem: question.stem,
            options: question.options,
            ...(withAnswers ? { answerKey: question.answerKey } : {}),
          })),
        }
      } catch (error) {
        return wordbookError(error, reply, request.id)
      }
    },
  )

  app.post(
    '/v1/word-quizzes/:id/answers',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'child' || !request.authContext.kidId) {
        return notFound(reply, request.id)
      }
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      const body = z
        .object({
          answers: z
            .array(
              z.object({
                questionId: z.uuid(),
                selectedKey: z.enum(['A', 'B', 'C', 'D']),
                clientEventId: z.string().trim().min(1).max(120).optional(),
              }),
            )
            .min(1)
            .max(50),
        })
        .safeParse(request.body)
      if (!params.success) {
        return invalidContent(reply, request.id, params.error.issues)
      }
      if (!body.success) {
        return invalidContent(reply, request.id, body.error.issues)
      }
      try {
        return await wordbookService.submitAnswers({
          familyId: request.authContext.familyId,
          kidId: request.authContext.kidId,
          quizId: params.data.id,
          answers: body.data.answers,
        })
      } catch (error) {
        return wordbookError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/word-stats',
    { preHandler: authenticate },
    async (request, reply) => {
      const kidId = request.authContext.kidId
      if (!kidId) return notFound(reply, request.id)
      return wordbookService.stats(request.authContext.familyId, kidId)
    },
  )

  app.get(
    '/v1/word-wrong-items',
    { preHandler: authenticate },
    async (request, reply) => {
      const kidId = request.authContext.kidId
      if (!kidId) return notFound(reply, request.id)
      const parsed = z
        .object({
          status: z.enum(['active', 'mastered']).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        })
        .safeParse(request.query)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      const items = await wordbookService.listWrongItems(
        request.authContext.familyId,
        kidId,
        parsed.data.status,
      )
      return { items: items.slice(0, parsed.data.limit) }
    },
  )

  app.patch(
    '/v1/word-wrong-items/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const kidId = request.authContext.kidId
      if (!kidId) return notFound(reply, request.id)
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      const body = z
        .object({ status: z.enum(['active', 'mastered']) })
        .safeParse(request.body)
      if (!params.success) {
        return invalidContent(reply, request.id, params.error.issues)
      }
      if (!body.success) {
        return invalidContent(reply, request.id, body.error.issues)
      }
      try {
        await wordbookService.updateWrongStatus({
          familyId: request.authContext.familyId,
          kidId,
          id: params.data.id,
          status: body.data.status,
        })
        return { ok: true }
      } catch (error) {
        return wordbookError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/training/today',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'child') {
        return reply.code(404).send({
          code: 'NOT_FOUND',
          message: '资源不存在',
          requestId: request.id,
          retryable: false,
        })
      }
      return trainingService.getToday(request.authContext)
    },
  )

  app.post(
    '/v1/training/attempts/start',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'child') {
        return notFound(reply, request.id)
      }
      const parsed = z
        .object({
          attemptId: z.uuid(),
          questionId: z.uuid(),
        })
        .safeParse(request.body)
      if (!parsed.success) {
        return invalidContent(reply, request.id, parsed.error.issues)
      }
      try {
        return await trainingService.startAttempt(
          request.authContext,
          parsed.data,
        )
      } catch (error) {
        return trainingError(error, reply, request.id)
      }
    },
  )

  app.post(
    '/v1/answers/check',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'child') {
        return reply.code(404).send({
          code: 'NOT_FOUND',
          message: '资源不存在',
          requestId: request.id,
          retryable: false,
        })
      }

      const parsed = z
        .object({
          submissionId: z.uuid().optional(),
          attemptId: z.uuid(),
          questionId: z.uuid(),
          answer: z.string().trim().min(1).max(5_000),
          finalizeAttempt: z.boolean().optional(),
        })
        .safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          code: 'INVALID_ANSWER',
          message: '作答格式不正确',
          requestId: request.id,
          retryable: false,
        })
      }
      try {
        return await trainingService.checkAnswer(request.authContext, {
          attemptId: parsed.data.attemptId,
          questionId: parsed.data.questionId,
          answer: parsed.data.answer,
          ...(parsed.data.submissionId
            ? { submissionId: parsed.data.submissionId }
            : {}),
          ...(parsed.data.finalizeAttempt
            ? { finalizeAttempt: true }
            : {}),
        })
      } catch (error) {
        return trainingError(error, reply, request.id)
      }
    },
  )

  app.post(
    '/v1/guide',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'child') {
        return reply.code(404).send({
          code: 'NOT_FOUND',
          message: '资源不存在',
          requestId: request.id,
          retryable: false,
        })
      }

      const parsed = z
        .object({
          attemptId: z.uuid(),
          questionId: z.uuid(),
          selectedAnswer: z.enum(['A', 'B', 'C', 'D']).default('A'),
          kidInput: z.string().trim().max(5_000),
        })
        .safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          code: 'INVALID_GUIDE_REQUEST',
          message: '提示请求格式不正确',
          requestId: request.id,
          retryable: false,
        })
      }
      try {
        return await trainingService.getHint(request.authContext, parsed.data)
      } catch (error) {
        return trainingError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/wrong-items',
    { preHandler: authenticate },
    async (request, reply) => {
      const query = z
        .object({
          status: z.enum(['active', 'mastered', 'archived']).optional(),
        })
        .safeParse(request.query)
      if (!query.success) {
        return invalidContent(reply, request.id, query.error.issues)
      }
      return wrongBookService.list(request.authContext, query.data.status)
    },
  )

  app.post(
    '/v1/wrong-items/photo',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      if (
        !wrongBookService.isPhotoRecognitionConfigured(
          request.authContext.familyId,
        )
      ) {
        return reply.code(409).send({
          code: 'VISION_NOT_CONFIGURED',
          message: '拍照识别需要先在模型配置中启用 Vision 模型',
          requestId: request.id,
          retryable: false,
        })
      }
      const file = await request.file()
      const supportedImageTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
      ] as const
      if (
        !file ||
        !supportedImageTypes.includes(
          file.mimetype as (typeof supportedImageTypes)[number],
        )
      ) {
        return reply.code(400).send({
          code: 'INVALID_WRONG_ITEM_PHOTO',
          message: '请选择 JPG、PNG 或 WebP 图片',
          requestId: request.id,
          retryable: false,
        })
      }
      try {
        const data = await file.toBuffer()
        if (data.length > 10 * 1024 * 1024) {
          return reply.code(413).send({
            code: 'WRONG_ITEM_PHOTO_TOO_LARGE',
            message: '图片大小不能超过 10 MB',
            requestId: request.id,
            retryable: false,
          })
        }
        const item = await wrongBookService.createFromPhoto(
          request.authContext,
          {
            mimeType: file.mimetype as
              | 'image/jpeg'
              | 'image/png'
              | 'image/webp',
            data,
          },
        )
        return reply.code(201).send({ item })
      } catch (error) {
        return wrongBookError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/wrong-items/:id/photo',
    { preHandler: authenticate },
    async (request, reply) => {
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      if (!params.success) return notFound(reply, request.id)
      const photo = await wrongBookService.getPhoto(
        request.authContext,
        params.data.id,
      )
      if (!photo) return notFound(reply, request.id)
      return reply
        .header('cache-control', 'private, max-age=300')
        .type(photo.mimeType)
        .send(photo.data)
    },
  )

  app.patch(
    '/v1/wrong-items/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      const body = z
        .object({
          status: z.enum(['active', 'mastered', 'archived']).optional(),
          kpId: z.uuid().optional(),
          tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
          note: z.string().max(1_000).optional(),
        })
        .refine((value) => Object.keys(value).length > 0)
        .safeParse(request.body)
      if (!params.success || !body.success) {
        return invalidContent(reply, request.id, [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
        ])
      }
      try {
        const item = await wrongBookService.update(
          request.authContext,
          params.data.id,
          {
            ...(body.data.status ? { status: body.data.status } : {}),
            ...(body.data.kpId ? { kpId: body.data.kpId } : {}),
            ...(body.data.tags ? { tags: body.data.tags } : {}),
            ...(body.data.note !== undefined ? { note: body.data.note } : {}),
          },
        )
        return { item }
      } catch (error) {
        return wrongBookError(error, reply, request.id)
      }
    },
  )

  app.delete(
    '/v1/wrong-items/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      if (!params.success) return notFound(reply, request.id)
      try {
        await wrongBookService.remove(request.authContext, params.data.id)
        return reply.code(204).send()
      } catch (error) {
        return wrongBookError(error, reply, request.id)
      }
    },
  )

  app.post(
    '/v1/wrong-items/:id/reviews',
    { preHandler: authenticate },
    async (request, reply) => {
      const params = z.object({ id: z.uuid() }).safeParse(request.params)
      const body = z
        .object({ result: z.enum(['correct', 'incorrect']) })
        .safeParse(request.body)
      if (!params.success || !body.success) {
        return invalidContent(reply, request.id, [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
        ])
      }
      try {
        await wrongBookService.recordReview(
          request.authContext,
          params.data.id,
          body.data.result,
        )
        return reply.code(204).send()
      } catch (error) {
        return wrongBookError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/mastery',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      return masteryService.list(request.authContext)
    },
  )

  app.get(
    '/v1/mastery/:kpId/evidence',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z.object({ kpId: z.uuid() }).safeParse(request.params)
      if (!params.success) {
        return invalidContent(reply, request.id, params.error.issues)
      }
      try {
        return await masteryService.evidence(
          request.authContext,
          params.data.kpId,
        )
      } catch (error) {
        return masteryError(error, reply, request.id)
      }
    },
  )

  app.post(
    '/v1/mastery/:kpId/reviews',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      const params = z.object({ kpId: z.uuid() }).safeParse(request.params)
      const body = z
        .object({
          projectionVersion: z.number().int().positive(),
          decision: z.enum(['agree', 'disagree', 'unsure']),
          note: z.string().trim().max(500).optional(),
        })
        .safeParse(request.body)
      if (!params.success || !body.success) {
        return invalidContent(reply, request.id, [
          ...(params.success ? [] : params.error.issues),
          ...(body.success ? [] : body.error.issues),
        ])
      }
      try {
        const review = await masteryService.review(
          request.authContext,
          params.data.kpId,
          {
            projectionVersion: body.data.projectionVersion,
            decision: body.data.decision,
            ...(body.data.note ? { note: body.data.note } : {}),
          },
        )
        return reply.code(201).send({ review })
      } catch (error) {
        return masteryError(error, reply, request.id)
      }
    },
  )

  app.get(
    '/v1/reports/weekly',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return notFound(reply, request.id)
      }
      return masteryService.weeklyReport(request.authContext)
    },
  )

  app.post(
    '/v1/events',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = eventBatchInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          code: 'INVALID_EVENT_BATCH',
          message: '事件批次格式不正确',
          requestId: request.id,
          retryable: false,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            code: issue.code,
          })),
        })
      }

      return eventService.ingest(request.authContext, parsed.data.events)
    },
  )

  app.get(
    '/v1/dev/events',
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.authContext.role !== 'parent') {
        return reply.code(404).send({
          code: 'NOT_FOUND',
          message: '资源不存在',
          requestId: request.id,
          retryable: false,
        })
      }
      return {
        events: await eventRepository.listForFamily(request.authContext.familyId),
      }
    },
  )

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined
    if (statusCode === 429) {
      request.log.warn({ err: error }, 'request rate limited')
      return reply.code(429).send({
        code: 'RATE_LIMITED',
        message: '请求过于频繁，请稍后重试',
        requestId: request.id,
        retryable: true,
      })
    }
    const normalized =
      error instanceof Error ? error : new Error('Unknown request error')
    request.log.error(
      {
        err: {
          name: normalized.name,
          message: normalized.message,
          stack: normalized.stack,
        },
      },
      'request failed',
    )
    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: '服务暂时不可用',
      requestId: request.id,
      retryable: true,
    })
  })

  app.addHook('onClose', async () => {
    routineScheduler.stop()
    await Promise.all([
      eventRepository.close(),
      contentRepository.close(),
      textbookImportService.close(),
      assessmentService.close(),
      modelConfigService.close(),
      trainingService.close(),
      masteryService.close(),
      guideAuditRepository.close(),
      wrongBookService.close(),
      planningService.close(),
      wordbookService.close(),
    ])
  })

  if (options.startSchedulers ?? true) routineScheduler.start()
  return app
}

function wordbookError(
  error: unknown,
  reply: FastifyReply,
  requestId: string,
) {
  if (!(error instanceof Error)) throw error
  const notFoundCodes = new Set([
    'WORDBOOK_NOT_FOUND',
    'WORD_QUIZ_NOT_FOUND',
    'WORD_QUIZ_QUESTION_NOT_FOUND',
    'WORD_WRONG_ITEM_NOT_FOUND',
  ])
  if (notFoundCodes.has(error.message)) return notFound(reply, requestId)

  const known: Record<
    string,
    { status: number; message: string; retryable: boolean }
  > = {
    WORDBOOK_NO_ENTRIES: {
      status: 422,
      message:
        '未能从文件中识别出词条，请确认每行包含英文单词与中文释义，或改为粘贴文本导入',
      retryable: false,
    },
    WORDBOOK_NOT_CONFIRMED: {
      status: 409,
      message: '请先确认单词本内容，再创建考察',
      retryable: false,
    },
    WORDBOOK_ALREADY_CONFIRMED: {
      status: 409,
      message: '单词本已确认，不能再次修改词条',
      retryable: false,
    },
    WORDBOOK_TOO_SMALL: {
      status: 409,
      message: '单词本至少需要 4 个释义互不相同的词条才能出选择题',
      retryable: false,
    },
    INVALID_PDF: {
      status: 422,
      message: '文件不是有效的 PDF',
      retryable: false,
    },
    PDF_TEXT_LAYER_REQUIRED: {
      status: 422,
      message: 'PDF 没有可提取文本（可能是扫描件），请提供电子版或改用 Word',
      retryable: false,
    },
    DOCX_UNREADABLE: {
      status: 422,
      message: 'Word 文件无法解析，请另存为 .docx 后重试',
      retryable: false,
    },
  }
  const mapped = known[error.message]
  if (!mapped) throw error
  return reply.code(mapped.status).send({
    code: error.message,
    message: mapped.message,
    requestId,
    retryable: mapped.retryable,
  })
}

function wrongBookError(
  error: unknown,
  reply: FastifyReply,
  requestId: string,
) {
  if (
    error instanceof z.ZodError ||
    error instanceof SyntaxError ||
    (error instanceof Error &&
      (/^LLM_REQUEST_FAILED(?::\d{3})?$/.test(error.message) ||
        error.message === 'LLM_REQUEST_TIMEOUT' ||
        error.message === 'LLM_EMPTY_RESPONSE'))
  ) {
    return reply.code(502).send({
      code: 'WRONG_ITEM_RECOGNITION_UNAVAILABLE',
      message: '图片识别或知识点映射暂时不可用，请稍后重试',
      requestId,
      retryable: true,
    })
  }
  if (!(error instanceof Error)) throw error
  if (error.message === 'WRONG_ITEM_NOT_FOUND') {
    return notFound(reply, requestId)
  }
  const known: Record<
    string,
    { status: number; message: string; retryable: boolean }
  > = {
    VISION_NOT_CONFIGURED: {
      status: 409,
      message: '拍照识别需要先在模型配置中启用 Vision 模型',
      retryable: false,
    },
    NO_PUBLISHED_KNOWLEDGE_POINTS: {
      status: 409,
      message: '请先导入并确认教材知识结构',
      retryable: false,
    },
    VISION_UNKNOWN_KNOWLEDGE_POINT: {
      status: 422,
      message: '识别结果无法映射到当前教材知识点，请重试',
      retryable: true,
    },
    KNOWLEDGE_POINT_NOT_FOUND: {
      status: 409,
      message: '选择的知识点不存在或尚未发布',
      retryable: false,
    },
  }
  const response = known[error.message]
  if (!response) throw error
  return reply.code(response.status).send({
    code: error.message,
    message: response.message,
    requestId,
    retryable: response.retryable,
  })
}

function masteryError(
  error: unknown,
  reply: FastifyReply,
  requestId: string,
) {
  if (!(error instanceof Error)) throw error
  if (error.message === 'MASTERY_PROJECTION_NOT_FOUND') {
    return notFound(reply, requestId)
  }
  const known: Record<string, { status: number; message: string }> = {
    PROJECTION_CHANGED: {
      status: 409,
      message: '学习证据已更新，请刷新后重新复核',
    },
    MASTERY_EVIDENCE_INSUFFICIENT: {
      status: 409,
      message: '当前证据不足，暂时无需复核',
    },
  }
  const response = known[error.message]
  if (!response) throw error
  return reply.code(response.status).send({
    code: error.message,
    message: response.message,
    requestId,
    retryable: false,
  })
}

function planningError(
  error: unknown,
  reply: FastifyReply,
  requestId: string,
) {
  if (!(error instanceof Error)) throw error
  if (error.message === 'TASK_NOT_FOUND' || error.message === 'PROGRESS_NOT_FOUND') {
    return notFound(reply, requestId)
  }
  const known: Record<string, { status: number; message: string }> = {
    TASK_TRANSITION_FORBIDDEN: {
      status: 403,
      message: '当前角色不能执行这个任务状态变更',
    },
    KNOWLEDGE_POINT_NOT_FOUND: {
      status: 409,
      message: '知识点不存在或尚未发布',
    },
  }
  const response = known[error.message]
  if (!response) throw error
  return reply.code(response.status).send({
    code: error.message,
    message: response.message,
    requestId,
    retryable: false,
  })
}

function trainingError(
  error: unknown,
  reply: FastifyReply,
  requestId: string,
) {
  if (
    error instanceof z.ZodError ||
    error instanceof SyntaxError ||
    (error instanceof Error &&
      (/^LLM_REQUEST_FAILED(?::\d{3})?$/.test(error.message) ||
        error.message === 'LLM_REQUEST_TIMEOUT'))
  ) {
    return reply.code(502).send({
      code: 'SUBJECTIVE_GRADING_UNAVAILABLE',
      message: '主观题评分暂时不可用，答案仍保留在输入框中，请稍后重试',
      requestId,
      retryable: true,
    })
  }
  if (!(error instanceof Error)) throw error
  if (
    error.message === 'QUESTION_NOT_FOUND' ||
    error.message === 'ATTEMPT_NOT_FOUND' ||
    error.message === 'TRAINING_SESSION_NOT_FOUND'
  ) {
    return notFound(reply, requestId)
  }
  const known: Record<string, { status: number; message: string }> = {
    SESSION_LIMIT_REACHED: {
      status: 409,
      message: '今天已经学习 25 分钟，先完成当前题，不再开启新题',
    },
    SESSION_CLOSED: {
      status: 409,
      message: '今天的训练已结束，请休息一下',
    },
    ATTEMPT_COMPLETED: {
      status: 409,
      message: '这道题已经完成',
    },
    ATTEMPT_IN_PROGRESS: {
      status: 409,
      message: '请先完成当前题',
    },
    ANSWER_SUBMISSION_CONFLICT: {
      status: 409,
      message: '本次答题记录与已有记录冲突，请刷新后重试',
    },
    SUBJECTIVE_GRADER_NOT_CONFIGURED: {
      status: 503,
      message: '主观题评分模型尚未配置',
    },
  }
  const response = known[error.message]
  if (!response) throw error
  return reply.code(response.status).send({
    code: error.message,
    message: response.message,
    requestId,
    retryable: false,
  })
}

function assessmentError(
  error: unknown,
  reply: FastifyReply,
  requestId: string,
) {
  if (error instanceof z.ZodError) {
    return reply.code(422).send({
      code: 'LLM_INVALID_QUESTION',
      message: '大模型生成的题目未通过质量或安全校验',
      requestId,
      retryable: false,
    })
  }
  if (!(error instanceof Error)) throw error
  if (
    /^LLM_REQUEST_FAILED(?::\d{3})?$/.test(error.message) ||
    error.message === 'LLM_REQUEST_TIMEOUT' ||
    error.message === 'LLM_EMPTY_RESPONSE' ||
    error instanceof SyntaxError
  ) {
    return reply.code(502).send({
      code: 'LLM_QUESTION_GENERATION_UNAVAILABLE',
      message: '题目生成模型暂时不可用，请稍后重试',
      requestId,
      retryable: true,
    })
  }
  const known: Record<string, { status: number; message: string }> = {
    LLM_NOT_CONFIGURED: {
      status: 503,
      message: '请先在服务端配置大模型 API',
    },
    KNOWLEDGE_POINT_NOT_FOUND: {
      status: 409,
      message: '目标知识点不存在或尚未发布',
    },
    NO_PUBLISHED_KNOWLEDGE_POINTS: {
      status: 409,
      message: '请先导入并确认教材知识结构',
    },
    LLM_QUESTION_COUNT_MISMATCH: {
      status: 422,
      message: '大模型返回的题目数量不符合要求',
    },
    LLM_UNKNOWN_KNOWLEDGE_POINT: {
      status: 422,
      message: '大模型生成了目标范围外的题目',
    },
    LLM_DUPLICATE_QUESTIONS: {
      status: 422,
      message: '大模型生成了重复题目',
    },
    LLM_QUESTION_TYPE_MISMATCH: {
      status: 422,
      message: '大模型返回的题型组合不符合组卷要求',
    },
  }
  const response = known[error.message]
  if (!response) throw error
  return reply.code(response.status).send({
    code: error.message,
    message: response.message,
    requestId,
    retryable: false,
  })
}

function notFound(reply: FastifyReply, requestId: string) {
  return reply.code(404).send({
    code: 'NOT_FOUND',
    message: '资源不存在',
    requestId,
    retryable: false,
  })
}

function invalidContent(
  reply: FastifyReply,
  requestId: string,
  issues: z.core.$ZodIssue[],
) {
  return reply.code(400).send({
    code: 'INVALID_CONTENT',
    message: '内容格式不正确',
    requestId,
    retryable: false,
    issues: issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
    })),
  })
}

export function contextForTest(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'test-request',
    userId: '33333333-3333-4333-8333-333333333333',
    role: 'child',
    familyId: '11111111-1111-4111-8111-111111111111',
    kidId: '33333333-3333-4333-8333-333333333333',
    deviceId: '55555555-5555-4555-8555-555555555555',
    ...overrides,
  }
}
