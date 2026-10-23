import { describe, expect, it } from 'vitest'
import {
  SecretCipher,
  type ModelConfigRepository,
  type StoredModelCapabilityConfig,
} from './model-config-service.js'
import { migrateModelConfigs } from './model-config-migration.js'

const familyId = '11111111-1111-4111-8111-111111111111'

class MemoryRepository implements ModelConfigRepository {
  readonly configs: StoredModelCapabilityConfig[] = []

  async get(): Promise<StoredModelCapabilityConfig | undefined> {
    return undefined
  }

  async list(requestedFamilyId: string): Promise<StoredModelCapabilityConfig[]> {
    return this.configs
      .filter((config) => config.familyId === requestedFamilyId)
      .map((config) => structuredClone(config))
  }

  async save(config: StoredModelCapabilityConfig): Promise<void> {
    this.configs.push(structuredClone(config))
  }

  async close(): Promise<void> {}
}

describe('migrateModelConfigs', () => {
  it('decrypts legacy keys and re-encrypts them with the target key', async () => {
    const sourceCipher = new SecretCipher('legacy-key')
    const targetCipher = new SecretCipher('database-key')
    const source = new MemoryRepository()
    const target = new MemoryRepository()
    source.configs.push({
      familyId,
      capability: 'chat',
      enabled: true,
      primary: {
        baseUrl: 'https://example.test/v1',
        model: 'primary-model',
        encryptedApiKey: sourceCipher.encrypt('primary-secret'),
      },
      fallback: {
        baseUrl: 'https://fallback.test/v1',
        model: 'fallback-model',
        encryptedApiKey: sourceCipher.encrypt('fallback-secret'),
      },
      retryCount: 2,
      timeoutMs: 90_000,
      updatedAt: '2026-10-10T00:00:00.000Z',
    })

    const result = await migrateModelConfigs(
      familyId,
      source,
      target,
      sourceCipher,
      targetCipher,
    )

    expect(result.capabilities).toEqual(['chat'])
    expect(target.configs[0]).toMatchObject({
      familyId,
      capability: 'chat',
      primary: {
        baseUrl: 'https://example.test/v1',
        model: 'primary-model',
      },
    })
    expect(
      targetCipher.decrypt(target.configs[0]!.primary.encryptedApiKey),
    ).toBe('primary-secret')
    expect(
      targetCipher.decrypt(
        target.configs[0]!.fallback!.encryptedApiKey,
      ),
    ).toBe('fallback-secret')
    expect(target.configs[0]!.primary.encryptedApiKey).not.toBe(
      source.configs[0]!.primary.encryptedApiKey,
    )
  })

  it('does not overwrite existing database configuration', async () => {
    const cipher = new SecretCipher('key')
    const source = new MemoryRepository()
    const target = new MemoryRepository()
    const config: StoredModelCapabilityConfig = {
      familyId,
      capability: 'embedding',
      enabled: true,
      primary: {
        baseUrl: 'https://example.test/v1',
        model: 'embedding-model',
        encryptedApiKey: cipher.encrypt('secret'),
      },
      retryCount: 1,
      timeoutMs: 30_000,
      updatedAt: '2026-10-10T00:00:00.000Z',
    }
    source.configs.push(config)
    target.configs.push(config)

    await expect(
      migrateModelConfigs(familyId, source, target, cipher, cipher),
    ).rejects.toThrow('TARGET_MODEL_CONFIG_NOT_EMPTY')
    expect(target.configs).toHaveLength(1)
  })
})
