import type { FastifyInstance } from 'fastify'

const durationBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]

interface RouteMetrics {
  count: number
  durationSeconds: number
  buckets: number[]
}

export function registerMetrics(app: FastifyInstance): void {
  const startedAt = process.hrtime.bigint()
  const routes = new Map<string, RouteMetrics>()
  let activeRequests = 0

  app.addHook('onRequest', async (request) => {
    activeRequests += 1
    request.metricsStartedAt = process.hrtime.bigint()
  })

  app.addHook('onResponse', async (request, reply) => {
    activeRequests = Math.max(0, activeRequests - 1)
    if (request.routeOptions.url === '/metrics') return
    const durationSeconds =
      Number(process.hrtime.bigint() - request.metricsStartedAt) / 1e9
    const route = request.routeOptions.url || 'unmatched'
    const key = JSON.stringify([request.method, route, reply.statusCode])
    const current = routes.get(key) ?? {
      count: 0,
      durationSeconds: 0,
      buckets: durationBuckets.map(() => 0),
    }
    current.count += 1
    current.durationSeconds += durationSeconds
    durationBuckets.forEach((bucket, index) => {
      if (durationSeconds <= bucket) current.buckets[index]! += 1
    })
    routes.set(key, current)
  })

  app.get(
    '/metrics',
    { config: { rateLimit: false } },
    async (_request, reply) => {
      const lines = [
      '# HELP kid_study_http_requests_total Completed HTTP requests.',
      '# TYPE kid_study_http_requests_total counter',
    ]
    for (const [key, value] of routes) {
      const [method, route, status] = JSON.parse(key) as [
        string,
        string,
        number,
      ]
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"`
      lines.push(`kid_study_http_requests_total{${labels}} ${value.count}`)
    }
    lines.push(
      '# HELP kid_study_http_request_duration_seconds HTTP request duration.',
      '# TYPE kid_study_http_request_duration_seconds histogram',
    )
    for (const [key, value] of routes) {
      const [method, route, status] = JSON.parse(key) as [
        string,
        string,
        number,
      ]
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"`
      durationBuckets.forEach((bucket, index) => {
        lines.push(
          `kid_study_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${value.buckets[index]}`,
        )
      })
      lines.push(
        `kid_study_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${value.count}`,
        `kid_study_http_request_duration_seconds_sum{${labels}} ${value.durationSeconds}`,
        `kid_study_http_request_duration_seconds_count{${labels}} ${value.count}`,
      )
    }
      const memory = process.memoryUsage()
      lines.push(
      '# HELP kid_study_http_active_requests Current in-flight HTTP requests.',
      '# TYPE kid_study_http_active_requests gauge',
      `kid_study_http_active_requests ${activeRequests}`,
      '# HELP kid_study_process_uptime_seconds Process uptime.',
      '# TYPE kid_study_process_uptime_seconds gauge',
      `kid_study_process_uptime_seconds ${Number(process.hrtime.bigint() - startedAt) / 1e9}`,
      '# HELP kid_study_process_resident_memory_bytes Resident memory.',
      '# TYPE kid_study_process_resident_memory_bytes gauge',
      `kid_study_process_resident_memory_bytes ${memory.rss}`,
    )
      return reply
        .type('text/plain; version=0.0.4; charset=utf-8')
        .send(`${lines.join('\n')}\n`)
    },
  )
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
}

declare module 'fastify' {
  interface FastifyRequest {
    metricsStartedAt: bigint
  }
}
