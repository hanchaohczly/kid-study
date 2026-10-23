import type {
  ModelCapability,
  ModelConfigRepository,
  StoredModelCapabilityConfig,
} from './model-config-service.js'

export class InMemoryModelConfigRepository implements ModelConfigRepository {
  private readonly configs = new Map<string, StoredModelCapabilityConfig>()

  async get(
    familyId: string,
    capability: ModelCapability,
  ): Promise<StoredModelCapabilityConfig | undefined> {
    const config = this.configs.get(`${familyId}:${capability}`)
    return config ? structuredClone(config) : undefined
  }

  async list(familyId: string): Promise<StoredModelCapabilityConfig[]> {
    return [...this.configs.values()]
      .filter((item) => item.familyId === familyId)
      .map((item) => structuredClone(item))
  }

  async save(config: StoredModelCapabilityConfig): Promise<void> {
    this.configs.set(
      `${config.familyId}:${config.capability}`,
      structuredClone(config),
    )
  }

  async close(): Promise<void> {}
}
