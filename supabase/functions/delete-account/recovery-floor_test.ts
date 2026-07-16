import { deepStrictEqual, equal, rejects, throws } from 'node:assert/strict'
import {
  createGitHubRecoveryFloorRecorder,
  deletionRecoveryFloorSafetyMs,
  deletionRecoveryFloorVariable,
} from './recovery-floor.ts'

const NOW = Date.parse('2026-07-15T12:00:00.000Z')
const PROPOSED = new Date(NOW + deletionRecoveryFloorSafetyMs).toISOString()

interface RecordedRequest {
  url: string
  method: string
  body: unknown
  authorization: string | null
}

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  })
}

function recorder(fetcher: typeof fetch) {
  return createGitHubRecoveryFloorRecorder({
    repository: 'greenthree/USTSACMLand',
    token: 'github_pat_test_token_1234567890',
    fetcher,
    now: () => NOW,
  })
}

Deno.test(
  'deletion recovery floor configuration rejects unsafe repository and token values',
  () => {
    throws(() =>
      createGitHubRecoveryFloorRecorder({
        repository: '../another-repository',
        token: 'github_pat_test_token_1234567890',
      }),
    )
    throws(() =>
      createGitHubRecoveryFloorRecorder({
        repository: 'greenthree/USTSACMLand',
        token: 'short',
      }),
    )
  },
)

Deno.test('deletion recovery floor creates a non-identifying repository variable', async () => {
  const requests: RecordedRequest[] = []
  const fetcher: typeof fetch = (input, init = {}) => {
    requests.push({
      url: String(input),
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : null,
      authorization: new Headers(init.headers).get('authorization'),
    })
    if (requests.length === 1) return Promise.resolve(response(404))
    if (requests.length === 2) return Promise.resolve(response(201))
    return Promise.resolve(response(200, { name: deletionRecoveryFloorVariable, value: PROPOSED }))
  }

  equal(await recorder(fetcher).record(), PROPOSED)
  equal(requests.length, 3)
  equal(requests[1].method, 'POST')
  deepStrictEqual(requests[1].body, {
    name: deletionRecoveryFloorVariable,
    value: PROPOSED,
  })
  equal(JSON.stringify(requests[1].body).includes('profile'), false)
  equal(JSON.stringify(requests[1].body).includes('user'), false)
  equal(requests[1].authorization, 'Bearer github_pat_test_token_1234567890')
})

Deno.test('deletion recovery floor never moves an existing later boundary backwards', async () => {
  const later = '2026-07-15T14:30:00.000Z'
  let requests = 0
  const fetcher: typeof fetch = () => {
    requests += 1
    return Promise.resolve(response(200, { name: deletionRecoveryFloorVariable, value: later }))
  }

  equal(await recorder(fetcher).record(), later)
  equal(requests, 1)
})

Deno.test('deletion recovery floor updates and confirms an older boundary', async () => {
  let requests = 0
  const fetcher: typeof fetch = (_input, init = {}) => {
    requests += 1
    if (requests === 1) {
      return Promise.resolve(
        response(200, {
          name: deletionRecoveryFloorVariable,
          value: '2026-07-01T00:00:00.000Z',
        }),
      )
    }
    if (requests === 2) {
      equal(init.method, 'PATCH')
      return Promise.resolve(response(204))
    }
    return Promise.resolve(response(200, { name: deletionRecoveryFloorVariable, value: PROPOSED }))
  }

  equal(await recorder(fetcher).record(), PROPOSED)
  equal(requests, 3)
})

Deno.test('deletion recovery floor tolerates a concurrent variable creation', async () => {
  let requests = 0
  const fetcher: typeof fetch = (_input, init = {}) => {
    requests += 1
    if (requests === 1) return Promise.resolve(response(404))
    if (requests === 2) {
      equal(init.method, 'POST')
      return Promise.resolve(response(422))
    }
    if (requests === 3) {
      equal(init.method, 'PATCH')
      return Promise.resolve(response(204))
    }
    return Promise.resolve(response(200, { name: deletionRecoveryFloorVariable, value: PROPOSED }))
  }

  equal(await recorder(fetcher).record(), PROPOSED)
  equal(requests, 4)
})

Deno.test(
  'deletion recovery floor fails closed on GitHub errors or stale confirmation',
  async () => {
    await rejects(
      () => recorder(() => Promise.resolve(response(503))).record(),
      /Could not read deletion recovery floor/,
    )

    let requests = 0
    await rejects(
      () =>
        recorder(() => {
          requests += 1
          if (requests === 1) return Promise.resolve(response(404))
          if (requests === 2) return Promise.resolve(response(201))
          return Promise.resolve(
            response(200, {
              name: deletionRecoveryFloorVariable,
              value: '2026-07-15T12:30:00.000Z',
            }),
          )
        }).record(),
      /could not be confirmed/,
    )
  },
)
