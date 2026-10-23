import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultModelConfigFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
  'data/model-configs.json',
)

export interface AppConfig {
  host: string
  port: number
  logLevel: string
  jwtSecret: string
  databaseUrl?: string
  parentPassword: string
  childPin: string
  secureCookie: boolean
  llmApiUrl?: string
  llmApiKey?: string
  llmModel?: string
  modelConfigEncryptionKey: string
  modelConfigFile: string
}

function readSecret(path: string | undefined): string | undefined {
  if (!path) return undefined
  return readFileSync(path, 'utf8').trim()
}

function databaseUrlFrom(env: NodeJS.ProcessEnv): string | undefined {
  const direct = env.DATABASE_URL?.trim()
  if (direct) return direct

  const password = readSecret(env.POSTGRES_PASSWORD_FILE)
  if (!password || !env.POSTGRES_HOST) return undefined

  const user = encodeURIComponent(env.POSTGRES_USER || 'kid_study')
  const encodedPassword = encodeURIComponent(password)
  const host = env.POSTGRES_HOST
  const port = env.POSTGRES_PORT || '5432'
  const database = encodeURIComponent(env.POSTGRES_DB || 'kid_study')
  return `postgres://${user}:${encodedPassword}@${host}:${port}/${database}`
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  return port
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = databaseUrlFrom(env)
  const production = env.NODE_ENV === 'production'
  const jwtSecret = env.JWT_SECRET?.trim()
  const parentPassword = env.DEV_PARENT_PASSWORD
  const childPin = env.DEV_CHILD_PIN
  const modelConfigEncryptionKey = env.MODEL_CONFIG_ENCRYPTION_KEY?.trim()

  if (
    production &&
    (!jwtSecret ||
      !parentPassword ||
      !childPin ||
      !databaseUrl ||
      !modelConfigEncryptionKey)
  ) {
    throw new Error(
      'Production requires JWT_SECRET, MODEL_CONFIG_ENCRYPTION_KEY, DEV_PARENT_PASSWORD, DEV_CHILD_PIN and PostgreSQL configuration',
    )
  }

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: parsePort(env.PORT),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    jwtSecret: jwtSecret || 'development-only-change-me',
    ...(databaseUrl ? { databaseUrl } : {}),
    parentPassword: parentPassword || 'dev-parent',
    childPin: childPin || '2468',
    secureCookie: env.COOKIE_SECURE === 'true',
    modelConfigEncryptionKey:
      modelConfigEncryptionKey || jwtSecret || 'development-model-config-key',
    modelConfigFile: resolve(
      env.MODEL_CONFIG_FILE?.trim() || defaultModelConfigFile,
    ),
    ...(env.LLM_API_URL?.trim() ? { llmApiUrl: env.LLM_API_URL.trim() } : {}),
    ...(env.LLM_API_KEY?.trim() ? { llmApiKey: env.LLM_API_KEY.trim() } : {}),
    ...(env.LLM_MODEL?.trim() ? { llmModel: env.LLM_MODEL.trim() } : {}),
  }
}
