import { describe, expect, it, vi } from 'vitest'
import { InMemoryModelConfigRepository } from './in-memory-model-config-repository.js'
import {
  ModelConfigService,
  SecretCipher,
} from './model-config-service.js'
import { ModelRouter } from './model-router.js'

const familyId = '11111111-1111-4111-8111-111111111111'

async function configuredService() {
  const repository = new InMemoryModelConfigRepository()
  const service = new ModelConfigService(
    repository,
    new SecretCipher('test-encryption-key'),
  )
  await service.save(familyId, 'chat', {
    enabled: true,
    primary: {
      baseUrl: 'https://primary.example/v1/chat/completions',
      model: 'primary-chat',
      apiKey: 'secret-primary-1234',
    },
    fallback: {
      baseUrl: 'https://fallback.example/v1/chat/completions',
      model: 'fallback-chat',
      apiKey: 'secret-fallback-5678',
    },
    retryCount: 1,
    timeoutMs: 30_000,
  })
  return { repository, service }
}

describe('ModelConfigService', () => {
  it('encrypts API keys at rest and only returns masked values', async () => {
    const { repository, service } = await configuredService()
    const stored = await repository.get(familyId, 'chat')
    const publicConfig = (await service.listPublic(familyId))[0]!

    expect(stored?.primary.encryptedApiKey).not.toContain(
      'secret-primary-1234',
    )
    expect(publicConfig.primary).toMatchObject({
      apiKeyMasked: '••••••••1234',
      hasApiKey: true,
    })
    expect(JSON.stringify(publicConfig)).not.toContain('secret-primary-1234')
  })

  it('keeps an existing API key when an update leaves it blank', async () => {
    const { service } = await configuredService()
    await service.save(familyId, 'chat', {
      enabled: true,
      primary: {
        baseUrl: 'https://primary.example/v1/chat/completions',
        model: 'primary-chat-v2',
      },
      retryCount: 2,
      timeoutMs: 60_000,
    })

    expect(service.get(familyId, 'chat')?.primary.apiKey).toBe(
      'secret-primary-1234',
    )
  })

  it('only reuses a saved API key for the same endpoint URL', async () => {
    const { service } = await configuredService()

    expect(
      service.resolveEndpoint(familyId, 'chat', 'primary', {
        baseUrl: 'https://primary.example/v1/chat/completions',
      }).apiKey,
    ).toBe('secret-primary-1234')
    expect(() =>
      service.resolveEndpoint(familyId, 'chat', 'primary', {
        baseUrl: 'https://other.example/v1',
      }),
    ).toThrow('MODEL_API_KEY_REQUIRED')
  })
})

describe('ModelRouter', () => {
  it('loads, deduplicates and sorts models from an OpenAI-compatible endpoint', async () => {
    const { service } = await configuredService()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'vision-model' },
            { id: 'chat-model' },
            { id: 'chat-model' },
            { id: '' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const models = await new ModelRouter(service, fetcher).listModels(
      familyId,
      'chat',
      'primary',
      { baseUrl: 'https://primary.example/v1/chat/completions' },
    )

    expect(models).toEqual(['chat-model', 'vision-model'])
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://primary.example/v1/models',
    )
    expect(
      new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer secret-primary-1234')
  })

  it('retries retryable failures then switches to the fallback model', async () => {
    const { service } = await configuredService()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    const router = new ModelRouter(service, fetcher)

    const result = await router.chatJson<{ ok: boolean }>(familyId, {
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(result).toMatchObject({
      data: { ok: true },
      usedFallback: true,
      attempts: 3,
      model: 'fallback-chat',
    })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://primary.example/v1/chat/completions',
      'https://primary.example/v1/chat/completions',
      'https://fallback.example/v1/chat/completions',
    ])
  })

  it('does not retry a non-retryable request error before fallback', async () => {
    const { service } = await configuredService()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    const result = await new ModelRouter(service, fetcher).chatJson<{
      ok: boolean
    }>(familyId, {
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(result.attempts).toBe(2)
    expect(result.usedFallback).toBe(true)
  })

  it('allows a caller to disable same-endpoint retries', async () => {
    const { service } = await configuredService()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }))

    await expect(
      new ModelRouter(service, fetcher).chatJson(familyId, {
        messages: [{ role: 'user', content: 'test' }],
        maxRetries: 0,
      }),
    ).rejects.toThrow('LLM_REQUEST_FAILED:503')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('normalizes endpoint timeouts into a retryable business error', async () => {
    const { service } = await configuredService()
    const timeout = new Error('The operation timed out')
    timeout.name = 'TimeoutError'
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(timeout)

    await expect(
      new ModelRouter(service, fetcher).chatJson(familyId, {
        messages: [{ role: 'user', content: 'test' }],
        maxRetries: 0,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow('LLM_REQUEST_TIMEOUT')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('expands an OpenAI-compatible v1 base URL for embeddings', async () => {
    const repository = new InMemoryModelConfigRepository()
    const service = new ModelConfigService(
      repository,
      new SecretCipher('test-encryption-key'),
    )
    await service.save(familyId, 'embedding', {
      enabled: true,
      primary: {
        baseUrl: 'https://gateway.example/v1',
        model: 'embedding-model',
        apiKey: 'secret',
      },
      retryCount: 0,
      timeoutMs: 30_000,
    })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await new ModelRouter(service, fetcher).embed(familyId, {
      input: '测试',
    })

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://gateway.example/v1/embeddings',
    )
    expect(
      JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      model: 'embedding-model',
      input: '测试',
      dimensions: 1024,
    })
    expect(result.data[0]).toHaveLength(3)
  })
})
