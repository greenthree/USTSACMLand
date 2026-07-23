// deno-lint-ignore-file require-await

import { strictEqual } from 'node:assert/strict'
import {
  createImageCleanupHandler,
  type ImageCleanupHandlerDependencies,
  type ImageCleanupServices,
} from './handler.ts'

function request(body: unknown = {}): Request {
  return new Request('https://example.test/webchat-image-cleanup', {
    method: 'POST',
    headers: {
      authorization: 'Bearer service-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function harness(overrides: Partial<ImageCleanupServices> = {}) {
  const calls: string[] = []
  const jobs = [
    {
      attachmentId: '11111111-1111-4111-8111-111111111111',
      objectKey:
        'user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/conversation/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/attachment/11111111-1111-4111-8111-111111111111.webp',
      attempt: 1,
    },
  ]
  const services: ImageCleanupServices = {
    hasDeadLetters: async () => false,
    reconcileStorageAccounting: async () => true,
    claimJobs: async () => jobs,
    deleteObject: async () => {
      calls.push('deleted-object')
    },
    completeJob: async () => {
      calls.push('completed')
      return true
    },
    retryJob: async (_id, _owner, _code, retryAfter) => {
      calls.push(`retried:${retryAfter}`)
      return true
    },
    ...overrides,
  }
  const dependencies: ImageCleanupHandlerDependencies = {
    isServiceRoleToken: (token) => token === 'service-token',
    createServices: () => services,
    reportUnexpectedError: async () => {
      calls.push('reported')
    },
  }
  return { handler: createImageCleanupHandler(dependencies), calls, jobs, dependencies }
}

Deno.test('claims and completes each Storage deletion exactly once', async () => {
  const { handler, calls } = harness()
  const response = await handler(request({ limit: 50 }))
  strictEqual(response.status, 200)
  const body = await response.json()
  strictEqual(body.claimed, 1)
  strictEqual(body.deleted, 1)
  strictEqual(body.deadLettersOutstanding, false)
  strictEqual(body.storageAccountingConsistent, true)
  strictEqual(calls.join(','), 'deleted-object,completed')
})

Deno.test('schedules one future attempt without retrying inside the same request', async () => {
  const { handler, calls } = harness({
    deleteObject: async () => {
      throw new Error('storage unavailable')
    },
  })
  const response = await handler(request())
  strictEqual(response.status, 207)
  const body = await response.json()
  strictEqual(body.retried, 1)
  strictEqual(body.deleted, 0)
  strictEqual(body.deadLettersOutstanding, false)
  strictEqual(calls.join(','), 'reported,retried:30')
})

Deno.test('reports the twenty-fifth failure as a recoverable dead letter', async () => {
  const { handler, jobs } = harness({
    deleteObject: async () => {
      throw new Error('storage unavailable')
    },
  })
  jobs[0]!.attempt = 25
  const response = await handler(request())
  const body = await response.json()
  strictEqual(response.status, 207)
  strictEqual(body.deadLettered, 1)
  strictEqual(body.retried, 0)
  strictEqual(body.deadLettersOutstanding, false)
})

Deno.test('fails instead of reporting a retry that was not persisted', async () => {
  const { handler, calls } = harness({
    deleteObject: async () => {
      throw new Error('storage unavailable')
    },
    retryJob: async () => {
      calls.push('retry-rejected')
      return false
    },
  })
  const response = await handler(request())
  const body = await response.json()
  strictEqual(response.status, 500)
  strictEqual(body.error.code, 'retry_transition_failed')
  strictEqual('retried' in body, false)
  strictEqual('deadLettered' in body, false)
  strictEqual(calls.join(','), 'reported,retry-rejected,reported')
})

Deno.test('surfaces a dead letter left by an earlier crashed worker', async () => {
  const { handler } = harness({ hasDeadLetters: async () => true, claimJobs: async () => [] })
  const response = await handler(request())
  strictEqual(response.status, 207)
  const body = await response.json()
  strictEqual(body.claimed, 0)
  strictEqual(body.deadLettersOutstanding, true)
})

Deno.test('surfaces Storage accounting drift after the database pauses new uploads', async () => {
  const { handler } = harness({
    claimJobs: async () => [],
    reconcileStorageAccounting: async () => false,
  })
  const response = await handler(request())
  strictEqual(response.status, 207)
  const body = await response.json()
  strictEqual(body.claimed, 0)
  strictEqual(body.storageAccountingConsistent, false)
})

Deno.test('rejects member JWTs and malformed limits before claiming work', async () => {
  let claimed = false
  const { dependencies } = harness({
    claimJobs: async () => {
      claimed = true
      return []
    },
  })
  const memberHandler = createImageCleanupHandler({
    ...dependencies,
    isServiceRoleToken: () => false,
  })
  strictEqual((await memberHandler(request())).status, 403)
  strictEqual((await createImageCleanupHandler(dependencies)(request({ limit: 101 }))).status, 400)
  strictEqual(claimed, false)
})

Deno.test('returns only aggregate counts and never object paths or attachment IDs', async () => {
  const { handler } = harness()
  const response = await handler(request())
  const text = await response.text()
  strictEqual(text.includes('/conversation/'), false)
  strictEqual(text.includes('11111111-1111-4111-8111-111111111111'), false)
})
