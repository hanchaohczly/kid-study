import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileModelConfigRepository } from './file-model-config-repository.js'
import { ModelConfigService, SecretCipher } from './model-config-service.js'

const familyId = '11111111-1111-4111-8111-111111111111'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('FileModelConfigRepository', () => {
  it('keeps encrypted model settings across repository instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kid-study-model-config-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'nested', 'model-configs.json')
    const encryptionKey = 'stable-development-encryption-key'
    const first = new ModelConfigService(
      new FileModelConfigRepository(filePath),
      new SecretCipher(encryptionKey),
    )

    await Promise.all([
      first.save(familyId, 'chat', {
        enabled: true,
        primary: {
          baseUrl: 'https://gateway.example/v1',
          model: 'chat-model',
          apiKey: 'private-chat-key-1234',
        },
        retryCount: 2,
        timeoutMs: 90_000,
      }),
      first.save(familyId, 'embedding', {
        enabled: true,
        primary: {
          baseUrl: 'https://gateway.example/v1',
          model: 'embedding-model',
          apiKey: 'private-embedding-key-5678',
        },
        retryCount: 1,
        timeoutMs: 60_000,
      }),
    ])
    await first.close()

    const rawFile = await readFile(filePath, 'utf8')
    expect(rawFile).not.toContain('private-chat-key-1234')
    expect(rawFile).not.toContain('private-embedding-key-5678')

    const second = new ModelConfigService(
      new FileModelConfigRepository(filePath),
      new SecretCipher(encryptionKey),
    )
    await second.initialize(familyId)

    expect(second.get(familyId, 'chat')).toMatchObject({
      enabled: true,
      primary: {
        baseUrl: 'https://gateway.example/v1',
        model: 'chat-model',
        apiKey: 'private-chat-key-1234',
      },
    })
    expect(second.get(familyId, 'embedding')).toMatchObject({
      enabled: true,
      primary: {
        model: 'embedding-model',
        apiKey: 'private-embedding-key-5678',
      },
    })
    await second.close()
  })
})
