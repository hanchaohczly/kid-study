import { Pool } from 'pg'
import type {
  ModelCapability,
  ModelConfigRepository,
  StoredModelCapabilityConfig,
} from './model-config-service.js'

interface ModelConfigRow {
  family_id: string
  capability: ModelCapability
  enabled: boolean
  primary_base_url: string
  primary_model: string
  primary_api_key: string
  fallback_base_url: string | null
  fallback_model: string | null
  fallback_api_key: string | null
  retry_count: number
  timeout_ms: number
  updated_at: Date
}

export class PostgresModelConfigRepository implements ModelConfigRepository {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 3 })
  }

  async get(
    familyId: string,
    capability: ModelCapability,
  ): Promise<StoredModelCapabilityConfig | undefined> {
    const result = await this.pool.query<ModelConfigRow>(
      `${selectConfig}
       where family_id = $1 and capability = $2`,
      [familyId, capability],
    )
    return result.rows[0] ? toConfig(result.rows[0]) : undefined
  }

  async list(familyId: string): Promise<StoredModelCapabilityConfig[]> {
    const result = await this.pool.query<ModelConfigRow>(
      `${selectConfig}
       where family_id = $1
       order by capability`,
      [familyId],
    )
    return result.rows.map(toConfig)
  }

  async save(config: StoredModelCapabilityConfig): Promise<void> {
    await this.pool.query(
      `insert into model_capability_config (
         family_id, capability, enabled, primary_base_url, primary_model,
         primary_api_key, fallback_base_url, fallback_model, fallback_api_key,
         retry_count, timeout_ms, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )
       on conflict (family_id, capability) do update
         set enabled = excluded.enabled,
             primary_base_url = excluded.primary_base_url,
             primary_model = excluded.primary_model,
             primary_api_key = excluded.primary_api_key,
             fallback_base_url = excluded.fallback_base_url,
             fallback_model = excluded.fallback_model,
             fallback_api_key = excluded.fallback_api_key,
             retry_count = excluded.retry_count,
             timeout_ms = excluded.timeout_ms,
             updated_at = excluded.updated_at`,
      [
        config.familyId,
        config.capability,
        config.enabled,
        config.primary.baseUrl,
        config.primary.model,
        config.primary.encryptedApiKey,
        config.fallback?.baseUrl ?? null,
        config.fallback?.model ?? null,
        config.fallback?.encryptedApiKey ?? null,
        config.retryCount,
        config.timeoutMs,
        config.updatedAt,
      ],
    )
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

const selectConfig = `
  select family_id, capability, enabled, primary_base_url, primary_model,
         primary_api_key, fallback_base_url, fallback_model, fallback_api_key,
         retry_count, timeout_ms, updated_at
    from model_capability_config
`

function toConfig(row: ModelConfigRow): StoredModelCapabilityConfig {
  return {
    familyId: row.family_id,
    capability: row.capability,
    enabled: row.enabled,
    primary: {
      baseUrl: row.primary_base_url,
      model: row.primary_model,
      encryptedApiKey: row.primary_api_key,
    },
    ...(row.fallback_base_url &&
    row.fallback_model &&
    row.fallback_api_key
      ? {
          fallback: {
            baseUrl: row.fallback_base_url,
            model: row.fallback_model,
            encryptedApiKey: row.fallback_api_key,
          },
        }
      : {}),
    retryCount: row.retry_count,
    timeoutMs: row.timeout_ms,
    updatedAt: row.updated_at.toISOString(),
  }
}
