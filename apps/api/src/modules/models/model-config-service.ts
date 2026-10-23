import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

export type ModelCapability = 'chat' | 'embedding' | 'vision'

export interface ModelEndpoint {
  baseUrl: string
  model: string
  apiKey: string
}

export interface ModelCapabilityConfig {
  capability: ModelCapability
  enabled: boolean
  primary: ModelEndpoint
  fallback?: ModelEndpoint
  retryCount: number
  timeoutMs: number
  updatedAt: string
}

export interface StoredModelCapabilityConfig
  extends Omit<ModelCapabilityConfig, 'primary' | 'fallback'> {
  familyId: string
  primary: Omit<ModelEndpoint, 'apiKey'> & { encryptedApiKey: string }
  fallback?: Omit<ModelEndpoint, 'apiKey'> & { encryptedApiKey: string }
}

export interface ModelConfigRepository {
  get(
    familyId: string,
    capability: ModelCapability,
  ): Promise<StoredModelCapabilityConfig | undefined>
  list(familyId: string): Promise<StoredModelCapabilityConfig[]>
  save(config: StoredModelCapabilityConfig): Promise<void>
  close(): Promise<void>
}

export interface ModelConfigInput {
  enabled: boolean
  primary: {
    baseUrl: string
    model: string
    apiKey?: string
  }
  fallback?: {
    baseUrl: string
    model: string
    apiKey?: string
  }
  retryCount: number
  timeoutMs: number
}

export type ModelEndpointTarget = 'primary' | 'fallback'

export interface ModelEndpointLookupInput {
  baseUrl: string
  apiKey?: string
}

export interface PublicModelCapabilityConfig {
  capability: ModelCapability
  enabled: boolean
  configured: boolean
  primary: {
    baseUrl: string
    model: string
    apiKeyMasked: string
    hasApiKey: boolean
  }
  fallback?: {
    baseUrl: string
    model: string
    apiKeyMasked: string
    hasApiKey: boolean
  }
  retryCount: number
  timeoutMs: number
  updatedAt?: string
}

export class SecretCipher {
  private readonly key: Uint8Array

  constructor(secret: string) {
    this.key = createHash('sha256').update(secret).digest()
  }

  encrypt(value: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ])
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.')
  }

  decrypt(value: string): string {
    const [version, iv, tag, encrypted] = value.split('.')
    if (version !== 'v1' || !iv || !tag || !encrypted) {
      throw new Error('INVALID_ENCRYPTED_SECRET')
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
}

export class ModelConfigService {
  private readonly cache = new Map<string, ModelCapabilityConfig>()

  constructor(
    private readonly repository: ModelConfigRepository,
    private readonly cipher: SecretCipher,
    private readonly environmentChat?: ModelCapabilityConfig,
  ) {}

  async initialize(familyId: string): Promise<void> {
    for (const stored of await this.repository.list(familyId)) {
      this.cache.set(this.key(familyId, stored.capability), this.decrypt(stored))
    }
  }

  get(
    familyId: string,
    capability: ModelCapability,
  ): ModelCapabilityConfig | undefined {
    return (
      this.cache.get(this.key(familyId, capability)) ??
      (capability === 'chat' ? this.environmentChat : undefined)
    )
  }

  isConfigured(familyId: string, capability: ModelCapability): boolean {
    const config = this.get(familyId, capability)
    return Boolean(
      config?.enabled &&
        config.primary.baseUrl &&
        config.primary.model &&
        config.primary.apiKey,
    )
  }

  resolveEndpoint(
    familyId: string,
    capability: ModelCapability,
    target: ModelEndpointTarget,
    input: ModelEndpointLookupInput,
  ): ModelEndpoint {
    const baseUrl = input.baseUrl.trim()
    const savedEndpoint = this.get(familyId, capability)?.[target]
    const apiKey =
      input.apiKey?.trim() ||
      (savedEndpoint?.baseUrl === baseUrl ? savedEndpoint.apiKey : '')
    if (!apiKey) {
      throw new Error('MODEL_API_KEY_REQUIRED')
    }
    return {
      baseUrl,
      model: '',
      apiKey,
    }
  }

  async listPublic(
    familyId: string,
  ): Promise<PublicModelCapabilityConfig[]> {
    const stored = new Map(
      (await this.repository.list(familyId)).map((item) => [
        item.capability,
        item,
      ]),
    )
    return (['chat', 'embedding', 'vision'] as const).map((capability) => {
      const config = stored.get(capability)
      if (config) return this.toPublic(this.decrypt(config))
      const environment =
        capability === 'chat' ? this.environmentChat : undefined
      return environment
        ? this.toPublic(environment)
        : {
            capability,
            enabled: false,
            configured: false,
            primary: {
              baseUrl: '',
              model: '',
              apiKeyMasked: '',
              hasApiKey: false,
            },
            retryCount: 2,
            timeoutMs: 90_000,
          }
    })
  }

  async save(
    familyId: string,
    capability: ModelCapability,
    input: ModelConfigInput,
  ): Promise<PublicModelCapabilityConfig> {
    const existing = await this.repository.get(familyId, capability)
    const existingConfig = existing ? this.decrypt(existing) : undefined
    const primaryApiKey =
      input.primary.apiKey?.trim() || existingConfig?.primary.apiKey
    if (input.enabled && !primaryApiKey) {
      throw new Error('MODEL_API_KEY_REQUIRED')
    }
    const fallbackApiKey = input.fallback
      ? input.fallback.apiKey?.trim() || existingConfig?.fallback?.apiKey
      : undefined
    if (input.fallback && !fallbackApiKey) {
      throw new Error('FALLBACK_API_KEY_REQUIRED')
    }

    const config: ModelCapabilityConfig = {
      capability,
      enabled: input.enabled,
      primary: {
        baseUrl: input.primary.baseUrl.trim(),
        model: input.primary.model.trim(),
        apiKey: primaryApiKey ?? '',
      },
      ...(input.fallback
        ? {
            fallback: {
              baseUrl: input.fallback.baseUrl.trim(),
              model: input.fallback.model.trim(),
              apiKey: fallbackApiKey!,
            },
          }
        : {}),
      retryCount: input.retryCount,
      timeoutMs: input.timeoutMs,
      updatedAt: new Date().toISOString(),
    }
    await this.repository.save(this.encrypt(familyId, config))
    this.cache.set(this.key(familyId, capability), config)
    return this.toPublic(config)
  }

  async close(): Promise<void> {
    await this.repository.close()
  }

  private encrypt(
    familyId: string,
    config: ModelCapabilityConfig,
  ): StoredModelCapabilityConfig {
    return {
      familyId,
      capability: config.capability,
      enabled: config.enabled,
      primary: {
        baseUrl: config.primary.baseUrl,
        model: config.primary.model,
        encryptedApiKey: this.cipher.encrypt(config.primary.apiKey),
      },
      ...(config.fallback
        ? {
            fallback: {
              baseUrl: config.fallback.baseUrl,
              model: config.fallback.model,
              encryptedApiKey: this.cipher.encrypt(config.fallback.apiKey),
            },
          }
        : {}),
      retryCount: config.retryCount,
      timeoutMs: config.timeoutMs,
      updatedAt: config.updatedAt,
    }
  }

  private decrypt(
    config: StoredModelCapabilityConfig,
  ): ModelCapabilityConfig {
    return {
      capability: config.capability,
      enabled: config.enabled,
      primary: {
        baseUrl: config.primary.baseUrl,
        model: config.primary.model,
        apiKey: this.cipher.decrypt(config.primary.encryptedApiKey),
      },
      ...(config.fallback
        ? {
            fallback: {
              baseUrl: config.fallback.baseUrl,
              model: config.fallback.model,
              apiKey: this.cipher.decrypt(config.fallback.encryptedApiKey),
            },
          }
        : {}),
      retryCount: config.retryCount,
      timeoutMs: config.timeoutMs,
      updatedAt: config.updatedAt,
    }
  }

  private toPublic(
    config: ModelCapabilityConfig,
  ): PublicModelCapabilityConfig {
    return {
      capability: config.capability,
      enabled: config.enabled,
      configured: Boolean(config.enabled && config.primary.apiKey),
      primary: {
        baseUrl: config.primary.baseUrl,
        model: config.primary.model,
        apiKeyMasked: maskSecret(config.primary.apiKey),
        hasApiKey: Boolean(config.primary.apiKey),
      },
      ...(config.fallback
        ? {
            fallback: {
              baseUrl: config.fallback.baseUrl,
              model: config.fallback.model,
              apiKeyMasked: maskSecret(config.fallback.apiKey),
              hasApiKey: Boolean(config.fallback.apiKey),
            },
          }
        : {}),
      retryCount: config.retryCount,
      timeoutMs: config.timeoutMs,
      updatedAt: config.updatedAt,
    }
  }

  private key(familyId: string, capability: ModelCapability): string {
    return `${familyId}:${capability}`
  }
}

function maskSecret(secret: string): string {
  if (!secret) return ''
  const suffix = secret.slice(-4)
  return `••••••••${suffix}`
}
