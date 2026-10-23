import { loadConfig } from './config.js'
import { FileModelConfigRepository } from './modules/models/file-model-config-repository.js'
import { migrateModelConfigs } from './modules/models/model-config-migration.js'
import {
  SecretCipher,
  type ModelConfigRepository,
} from './modules/models/model-config-service.js'
import { PostgresModelConfigRepository } from './modules/models/postgres-model-config-repository.js'

const defaultFamilyId = '11111111-1111-4111-8111-111111111111'

async function main(): Promise<void> {
  const sourceFile = process.env.LEGACY_MODEL_CONFIG_FILE?.trim()
  const sourceKey = process.env.LEGACY_MODEL_CONFIG_ENCRYPTION_KEY?.trim()
  if (!sourceFile || !sourceKey) {
    throw new Error(
      'LEGACY_MODEL_CONFIG_FILE and LEGACY_MODEL_CONFIG_ENCRYPTION_KEY are required',
    )
  }

  const config = loadConfig()
  if (!config.databaseUrl) {
    throw new Error('PostgreSQL configuration is required')
  }

  const source = new FileModelConfigRepository(sourceFile)
  const target = new PostgresModelConfigRepository(config.databaseUrl)
  try {
    const result = await migrateModelConfigs(
      process.env.FAMILY_ID?.trim() || defaultFamilyId,
      source,
      target,
      new SecretCipher(sourceKey),
      new SecretCipher(config.modelConfigEncryptionKey),
    )
    process.stdout.write(
      `${JSON.stringify({
        migrated: result.capabilities.length,
        capabilities: result.capabilities,
      })}\n`,
    )
  } finally {
    await closeRepositories(source, target)
  }
}

async function closeRepositories(
  ...repositories: ModelConfigRepository[]
): Promise<void> {
  await Promise.allSettled(repositories.map((repository) => repository.close()))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Model config migration failed: ${message}\n`)
  process.exitCode = 1
})
