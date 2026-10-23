import { createHash, timingSafeEqual } from 'node:crypto'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { RequestContext } from '@kid-study/contracts'
import type { AppConfig } from './config.js'

const demoIds = {
  familyId: '11111111-1111-4111-8111-111111111111',
  parentId: '22222222-2222-4222-8222-222222222222',
  childId: '33333333-3333-4333-8333-333333333333',
  parentDeviceId: '44444444-4444-4444-8444-444444444444',
  childDeviceId: '55555555-5555-4555-8555-555555555555',
} as const

interface AuthClaims {
  sub: string
  role: 'parent' | 'child'
  familyId: string
  kidId?: string
  deviceId: string
}

function credentialMatches(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

declare module 'fastify' {
  interface FastifyRequest {
    authContext: RequestContext
  }
}

function claimsFor(role: 'parent' | 'child'): AuthClaims {
  if (role === 'parent') {
    return {
      sub: demoIds.parentId,
      role,
      familyId: demoIds.familyId,
      kidId: demoIds.childId,
      deviceId: demoIds.parentDeviceId,
    }
  }

  return {
    sub: demoIds.childId,
    role,
    familyId: demoIds.familyId,
    kidId: demoIds.childId,
    deviceId: demoIds.childDeviceId,
  }
}

export async function registerAuth(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(cookie)
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => ({
      statusCode: context.statusCode,
      code: 'RATE_LIMITED',
      message: `请求过于频繁，请在 ${context.after} 后重试`,
      requestId: request.id,
      retryable: true,
    }),
  })
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: {
      cookieName: 'kid_study_session',
      signed: false,
    },
  })

  app.decorateRequest('authContext')

  app.post<{
    Body: { role?: string; credential?: string }
  }>(
    '/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const role = request.body?.role
      const credential = request.body?.credential

      if (role !== 'parent' && role !== 'child') {
        return reply.code(400).send({
          code: 'INVALID_ROLE',
          message: '角色必须是 parent 或 child',
          requestId: request.id,
          retryable: false,
        })
      }

      const expected = role === 'parent' ? config.parentPassword : config.childPin
      if (!credential || !credentialMatches(credential, expected)) {
        return reply.code(401).send({
          code: 'INVALID_CREDENTIAL',
          message: '凭证不正确',
          requestId: request.id,
          retryable: false,
        })
      }

      const claims = claimsFor(role)
      const token = await reply.jwtSign(claims, { expiresIn: '30m' })
      reply.setCookie('kid_study_session', token, {
        httpOnly: true,
        secure: config.secureCookie,
        sameSite: 'strict',
        path: '/',
        maxAge: 30 * 60,
      })

      return {
        user: {
          id: claims.sub,
          role: claims.role,
          kidId: claims.kidId,
        },
      }
    },
  )

  app.post('/v1/auth/logout', async (_request, reply) => {
    reply.clearCookie('kid_study_session', { path: '/' })
    return reply.code(204).send()
  })
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const claims = await request.jwtVerify<AuthClaims>()
    request.authContext = {
      requestId: request.id,
      userId: claims.sub,
      role: claims.role,
      familyId: claims.familyId,
      ...(claims.kidId ? { kidId: claims.kidId } : {}),
      deviceId: claims.deviceId,
    }
  } catch {
    await reply.code(401).send({
      code: 'UNAUTHENTICATED',
      message: '请先登录',
      requestId: request.id,
      retryable: false,
    })
  }
}
