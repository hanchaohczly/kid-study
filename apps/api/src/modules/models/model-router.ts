import type {
  ModelCapability,
  ModelConfigService,
  ModelEndpoint,
  ModelEndpointLookupInput,
  ModelEndpointTarget,
} from './model-config-service.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatJsonRequest {
  messages: ChatMessage[]
  temperature?: number
  maxRetries?: number
  timeoutMs?: number
}

export interface EmbeddingRequest {
  input: string | string[]
}

export interface VisionJsonRequest {
  prompt: string
  images: Array<{
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
    base64: string
  }>
}

export interface ModelRouteResult<T> {
  data: T
  usedFallback: boolean
  attempts: number
  model: string
}

export class ModelRouter {
  constructor(
    private readonly configs: ModelConfigService,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  isConfigured(familyId: string, capability: ModelCapability): boolean {
    return this.configs.isConfigured(familyId, capability)
  }

  async listModels(
    familyId: string,
    capability: ModelCapability,
    target: ModelEndpointTarget,
    input: ModelEndpointLookupInput,
  ): Promise<string[]> {
    const endpoint = this.configs.resolveEndpoint(
      familyId,
      capability,
      target,
      input,
    )
    const response = await this.fetcher(modelsEndpointUrl(endpoint.baseUrl), {
      method: 'GET',
      headers: this.headers(endpoint),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new ModelHttpError(response.status)

    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>
    }
    return [
      ...new Set(
        (payload.data ?? [])
          .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right))
  }

  chatJson<T>(
    familyId: string,
    request: ChatJsonRequest,
  ): Promise<ModelRouteResult<T>> {
    return this.execute<T>(
      familyId,
      'chat',
      (endpoint, signal) => ({
        url: endpointUrl(endpoint.baseUrl, 'chat'),
        init: {
          method: 'POST',
          headers: this.headers(endpoint),
          body: JSON.stringify({
            model: endpoint.model,
            temperature: request.temperature ?? 0.1,
            response_format: { type: 'json_object' },
            messages: request.messages,
          }),
          signal,
        },
        parse: async (response) => {
          const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>
          }
          const raw = payload.choices?.[0]?.message?.content
          if (!raw) throw new Error('LLM_EMPTY_RESPONSE')
          return JSON.parse(stripCodeFence(raw)) as T
        },
      }),
      request.maxRetries,
      request.timeoutMs,
    )
  }

  embed(
    familyId: string,
    request: EmbeddingRequest,
  ): Promise<ModelRouteResult<number[][]>> {
    return this.execute<number[][]>(
      familyId,
      'embedding',
      (endpoint, signal) => ({
        url: endpointUrl(endpoint.baseUrl, 'embedding'),
        init: {
          method: 'POST',
          headers: this.headers(endpoint),
          body: JSON.stringify({
            model: endpoint.model,
            input: request.input,
            dimensions: 1024,
          }),
          signal,
        },
        parse: async (response) => {
          const payload = (await response.json()) as {
            data?: Array<{ embedding?: number[] }>
          }
          const vectors =
            payload.data?.map((item) => item.embedding).filter(Boolean) ?? []
          if (!vectors.length) throw new Error('EMBEDDING_EMPTY_RESPONSE')
          return vectors as number[][]
        },
      }),
    )
  }

  visionJson<T>(
    familyId: string,
    request: VisionJsonRequest,
  ): Promise<ModelRouteResult<T>> {
    return this.execute<T>(familyId, 'vision', (endpoint, signal) => ({
      url: endpointUrl(endpoint.baseUrl, 'chat'),
      init: {
        method: 'POST',
        headers: this.headers(endpoint),
        body: JSON.stringify({
          model: endpoint.model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: request.prompt },
                ...request.images.map((image) => ({
                  type: 'image_url',
                  image_url: {
                    url: `data:${image.mimeType};base64,${image.base64}`,
                  },
                })),
              ],
            },
          ],
        }),
        signal,
      },
      parse: async (response) => {
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const raw = payload.choices?.[0]?.message?.content
        if (!raw) throw new Error('LLM_EMPTY_RESPONSE')
        return JSON.parse(stripCodeFence(raw)) as T
      },
    }))
  }

  private async execute<T>(
    familyId: string,
    capability: ModelCapability,
    build: (
      endpoint: ModelEndpoint,
      signal: AbortSignal,
    ) => {
      url: string
      init: RequestInit
      parse(response: Response): Promise<T>
    },
    retryCountOverride?: number,
    timeoutMsOverride?: number,
  ): Promise<ModelRouteResult<T>> {
    const config = this.configs.get(familyId, capability)
    if (!config?.enabled) throw new Error('LLM_NOT_CONFIGURED')
    const retryCount = retryCountOverride ?? config.retryCount
    const timeoutMs = Math.min(timeoutMsOverride ?? config.timeoutMs, config.timeoutMs)
    const endpoints = [
      { endpoint: config.primary, fallback: false },
      ...(config.fallback
        ? [{ endpoint: config.fallback, fallback: true }]
        : []),
    ]
    let attempts = 0
    let lastError: unknown

    for (const target of endpoints) {
      for (let retry = 0; retry <= retryCount; retry += 1) {
        attempts += 1
        try {
          const request = build(
            target.endpoint,
            AbortSignal.timeout(timeoutMs),
          )
          const response = await this.fetcher(request.url, request.init)
          if (!response.ok) {
            const error = new ModelHttpError(response.status)
            if (!error.retryable) {
              lastError = error
              break
            }
            throw error
          }
          return {
            data: await request.parse(response),
            usedFallback: target.fallback,
            attempts,
            model: target.endpoint.model,
          }
        } catch (error) {
          lastError = error
          if (!isRetryable(error) || retry === retryCount) break
        }
      }
    }
    throw normalizeModelError(lastError)
  }

  private headers(endpoint: ModelEndpoint): Record<string, string> {
    return {
      authorization: `Bearer ${endpoint.apiKey}`,
      'content-type': 'application/json',
    }
  }
}

class ModelHttpError extends Error {
  readonly retryable: boolean

  constructor(readonly status: number) {
    super(`LLM_REQUEST_FAILED:${status}`)
    this.retryable = status === 408 || status === 429 || status >= 500
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ModelHttpError) return error.retryable
  if (error instanceof SyntaxError) return false
  if (
    error instanceof Error &&
    (error.message === 'LLM_EMPTY_RESPONSE' ||
      error.message === 'EMBEDDING_EMPTY_RESPONSE')
  ) {
    return false
  }
  return true
}

function normalizeModelError(error: unknown): Error {
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return new Error('LLM_REQUEST_TIMEOUT')
  }
  if (error instanceof Error) return error
  return new Error('LLM_REQUEST_FAILED')
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
}

function endpointUrl(
  configuredUrl: string,
  capability: 'chat' | 'embedding',
): string {
  const normalized = configuredUrl.replace(/\/+$/, '')
  if (/\/v1$/i.test(normalized)) {
    return capability === 'embedding'
      ? `${normalized}/embeddings`
      : `${normalized}/chat/completions`
  }
  return normalized
}

function modelsEndpointUrl(configuredUrl: string): string {
  const normalized = configuredUrl.replace(/\/+$/, '')
  if (/\/models$/i.test(normalized)) return normalized
  if (
    /\/(?:chat\/completions|embeddings|images\/generations)$/i.test(normalized)
  ) {
    return normalized.replace(
      /\/(?:chat\/completions|embeddings|images\/generations)$/i,
      '/models',
    )
  }
  return `${normalized}/models`
}
