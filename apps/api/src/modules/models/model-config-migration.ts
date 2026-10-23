import type {
  ModelCapability,
  ModelConfigRepository,
  StoredModelCapabilityConfig,
} from './model-config-service.js'
import { SecretCipher } from './model-config-service.js'

export interface ModelConfigMigrationResult {
  familyId: string
  capabilities: ModelCapability[]
}

export async function migrateModelConfigs(
  familyId: string,
  sourceRepository: ModelConfigRepository,
  targetRepository: ModelConfigRepository,
  sourceCipher: SecretCipher,
  targetCipher: SecretCipher,
): Promise<ModelConfigMigrationResult> {
  const existing = await targetRepository.list(familyId)
  if (existing.length > 0) {
    throw new Error('TARGET_MODEL_CONFIG_NOT_EMPTY')
  }

  const source = await sourceRepository.list(familyId)
  if (source.length === 0) {
    throw new Error('SOURCE_MODEL_CONFIG_NOT_FOUND')
  }

  for (const config of source) {
    await targetRepository.save(
      reencryptConfig(config, sourceCipher, targetCipher),
    )
  }

  return {
    familyId,
    capabilities: source.map((config) => config.capability).sort(),
  }
}

function reencryptConfig(
  config: StoredModelCapabilityConfig,
  sourceCipher: SecretCipher,
  targetCipher: SecretCipher,
): StoredModelCapabilityConfig {
  return {
    ...config,
    primary: {
      ...config.primary,
      encryptedApiKey: targetCipher.encrypt(
        sourceCipher.decrypt(config.primary.encryptedApiKey),
      ),
    },
    ...(config.fallback
      ? {
          fallback: {
            ...config.fallback,
            encryptedApiKey: targetCipher.encrypt(
              sourceCipher.decrypt(config.fallback.encryptedApiKey),
            ),
          },
        }
      : {}),
  }
}
