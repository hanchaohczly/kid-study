const baseUrl = process.env.LOADTEST_URL ?? 'http://127.0.0.1:3000'
const requestCount = positiveInteger('LOADTEST_REQUESTS', 1_000)
const concurrency = positiveInteger('LOADTEST_CONCURRENCY', 25)
const p95LimitMs = positiveInteger('LOADTEST_P95_MS', 500)
const timeoutMs = positiveInteger('LOADTEST_TIMEOUT_MS', 3_000)
const durations = []
let nextRequest = 0
let failures = 0

await Promise.all(
  Array.from({ length: Math.min(concurrency, requestCount) }, async () => {
    while (true) {
      const requestNo = nextRequest++
      if (requestNo >= requestCount) return
      const startedAt = performance.now()
      try {
        const response = await fetch(`${baseUrl}/health/live`, {
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) failures += 1
        await response.arrayBuffer()
      } catch {
        failures += 1
      } finally {
        durations.push(performance.now() - startedAt)
      }
    }
  }),
)

durations.sort((left, right) => left - right)
const percentile = (fraction) =>
  durations[Math.min(durations.length - 1, Math.ceil(durations.length * fraction) - 1)]
const p50 = percentile(0.5)
const p95 = percentile(0.95)
const p99 = percentile(0.99)

console.log(
  JSON.stringify(
    {
      url: `${baseUrl}/health/live`,
      requests: requestCount,
      concurrency,
      failures,
      p50Ms: round(p50),
      p95Ms: round(p95),
      p99Ms: round(p99),
      thresholdMs: p95LimitMs,
    },
    null,
    2,
  ),
)

if (failures > 0 || p95 > p95LimitMs) process.exitCode = 1

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function round(value) {
  return Math.round(value * 100) / 100
}
