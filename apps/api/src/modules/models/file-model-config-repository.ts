import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type {
  ModelCapability,
  ModelConfigRepository,
  StoredModelCapabilityConfig,
} from './model-config-service.js'

const endpointSchema = z.object({
  baseUrl: z.string(),
  model: z.string(),
  encryptedApiKey: z.string(),
})

const storedConfigSchema = z.object({
  familyId: z.string(),
  capability: z.enum(['chat', 'embedding', 'vision']),
  enabled: z.boolean(),
  primary: endpointSchema,
  fallback: endpointSchema.optional(),
  retryCount: z.number().int(),
  timeoutMs: z.number().int(),
  updatedAt: z.string(),
})

const configFileSchema = z.object({
  version: z.literal(1),
  configs: z.array(storedConfigSchema),
})

export class FileModelConfigRepository implements ModelConfigRepository {
  private readonly configs = new Map<string, StoredModelCapabilityConfig>()
  private loadPromise?: Promise<void>
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async get(
    familyId: string,
    capability: ModelCapability,
  ): Promise<StoredModelCapabilityConfig | undefined> {
    await this.writeQueue
    await this.ensureLoaded()
    const config = this.configs.get(this.key(familyId, capability))
    return config ? structuredClone(config) : undefined
  }

  async list(familyId: string): Promise<StoredModelCapabilityConfig[]> {
    await this.writeQueue
    await this.ensureLoaded()
    return [...this.configs.values()]
      .filter((item) => item.familyId === familyId)
      .map((item) => structuredClone(item))
  }

  async save(config: StoredModelCapabilityConfig): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      await this.ensureLoaded()
      this.configs.set(
        this.key(config.familyId, config.capability),
        structuredClone(config),
      )
      await this.persist()
    })
    this.writeQueue = operation.catch(() => {})
    await operation
  }

  async close(): Promise<void> {
    await this.writeQueue
  }

  private async ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.load()
    await this.loadPromise
  }

  private async load(): Promise<void> {
    let contents: string
    try {
      contents = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return
      throw error
    }

    try {
      const parsed = configFileSchema.parse(JSON.parse(contents))
      for (const item of parsed.configs) {
        const config: StoredModelCapabilityConfig = {
          familyId: item.familyId,
          capability: item.capability,
          enabled: item.enabled,
          primary: item.primary,
          ...(item.fallback ? { fallback: item.fallback } : {}),
          retryCount: item.retryCount,
          timeoutMs: item.timeoutMs,
          updatedAt: item.updatedAt,
        }
        this.configs.set(this.key(config.familyId, config.capability), config)
      }
    } catch (error) {
      throw new Error(`Invalid model config file: ${this.filePath}`, {
        cause: error,
      })
    }
  }

  private async persist(): Promise<void> {
    const directory = dirname(this.filePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    const configs = [...this.configs.values()].sort((left, right) =>
      this.key(left.familyId, left.capability).localeCompare(
        this.key(right.familyId, right.capability),
      ),
    )

    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ version: 1, configs }, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      )
      await rename(temporaryPath, this.filePath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {})
    }
  }

  private key(familyId: string, capability: ModelCapability): string {
    return `${familyId}:${capability}`
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
