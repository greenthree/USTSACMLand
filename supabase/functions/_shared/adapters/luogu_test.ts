import { deepStrictEqual, throws } from 'node:assert/strict'
import { HttpError } from '../http.ts'
import {
  createLuoguAdapter,
  parseLuoguProfilePage,
  type LuoguProfilePage,
  type LuoguTransport,
} from './luogu.ts'

const fixtureBase = new URL('./testdata/', import.meta.url)

function fixture(name: string): Promise<string> {
  return Deno.readTextFile(new URL(name, fixtureBase))
}

function profileHtml(user: Record<string, unknown> | null): string {
  const context = encodeURIComponent(JSON.stringify({ data: { user } }))
  return `<html><body><script id="lentille-context" type="application/json">${context}</script></body></html>`
}

async function validProfile(): Promise<LuoguProfilePage> {
  return {
    html: await fixture('luogu-profile-valid.html'),
    finalUrl: 'https://www.luogu.com.cn/user/123456789',
  }
}

Deno.test('Luogu profile parser reads the public homepage passed problem count', async () => {
  deepStrictEqual(parseLuoguProfilePage(await validProfile(), '123456789'), 243)
})

Deno.test('Luogu profile parser accepts an unencoded JSON context', () => {
  const html = `<html><body><script id="lentille-context" type="application/json">${JSON.stringify({
    data: { user: { uid: 123456789, passedProblemCount: 0 } },
  })}</script></body></html>`
  deepStrictEqual(
    parseLuoguProfilePage(
      { html, finalUrl: 'https://www.luogu.com.cn/user/123456789' },
      '123456789',
    ),
    0,
  )
})

Deno.test('Luogu adapter returns the same count exposed on the public profile', async () => {
  const transport: LuoguTransport = { fetchProfile: validProfile }
  const result = await createLuoguAdapter({ transport }).sync('123456789')

  deepStrictEqual(result.ok, true)
  if (!result.ok) return
  deepStrictEqual(result.metrics, {
    currentRating: null,
    maxRating: null,
    solvedCount: 243,
  })
  deepStrictEqual(result.sourceUpdatedAt, null)
  deepStrictEqual(result.sourceVersion, 'luogu-public-profile-v1')
  deepStrictEqual(result.details, { statistic: 'data.user.passedProblemCount' })
})

Deno.test('Luogu adapter accepts a valid account with zero passed problems', async () => {
  const transport: LuoguTransport = {
    fetchProfile() {
      return Promise.resolve({
        html: profileHtml({ uid: 123456789, passedProblemCount: 0 }),
        finalUrl: 'https://www.luogu.com.cn/user/123456789',
      })
    },
  }

  const result = await createLuoguAdapter({ transport }).sync('123456789')

  deepStrictEqual(result.ok, true)
  if (!result.ok) return
  deepStrictEqual(result.metrics.solvedCount, 0)
})

Deno.test('Luogu adapter rejects an invalid UID before making requests', async () => {
  let requests = 0
  const transport: LuoguTransport = {
    fetchProfile() {
      requests += 1
      throw new Error('should not run')
    },
  }

  const result = await createLuoguAdapter({ transport }).sync('user-name')

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'invalid_account')
  deepStrictEqual(requests, 0)
})

Deno.test('Luogu profile parser rejects a mismatched UID', () => {
  throws(
    () =>
      parseLuoguProfilePage(
        {
          html: profileHtml({ uid: 987654321, passedProblemCount: 10 }),
          finalUrl: 'https://www.luogu.com.cn/user/123456789',
        },
        '123456789',
      ),
    HttpError,
    'Luogu returned the wrong user profile',
  )
})

Deno.test('Luogu profile parser rejects a redirect to another numeric UID', () => {
  throws(
    () =>
      parseLuoguProfilePage(
        {
          html: profileHtml({ uid: 987654321, passedProblemCount: 10 }),
          finalUrl: 'https://www.luogu.com.cn/user/987654321',
        },
        '123456789',
      ),
    HttpError,
    'Luogu returned the wrong user profile',
  )
})

Deno.test('Luogu adapter reports a missing public profile user as not found', async () => {
  const transport: LuoguTransport = {
    fetchProfile() {
      return Promise.resolve({
        html: profileHtml(null),
        finalUrl: 'https://www.luogu.com.cn/user/123456789',
      })
    },
  }

  const result = await createLuoguAdapter({ transport }).sync('123456789')

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'not_found')
})

Deno.test(
  'Luogu adapter treats a missing UID on a normal profile path as schema change',
  async () => {
    const transport: LuoguTransport = {
      fetchProfile() {
        return Promise.resolve({
          html: profileHtml({ passedProblemCount: 243 }),
          finalUrl: 'https://www.luogu.com.cn/user/123456789',
        })
      },
    }

    const result = await createLuoguAdapter({ transport }).sync('123456789')

    deepStrictEqual(result.ok, false)
    if (result.ok) return
    deepStrictEqual(result.error.code, 'schema_changed')
  },
)

Deno.test('Luogu adapter rejects a missing or invalid passed problem count', async () => {
  for (const passedProblemCount of [undefined, null, '243', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const transport: LuoguTransport = {
      fetchProfile() {
        return Promise.resolve({
          html: profileHtml({ uid: 123456789, passedProblemCount }),
          finalUrl: 'https://www.luogu.com.cn/user/123456789',
        })
      },
    }
    const result = await createLuoguAdapter({ transport }).sync('123456789')
    deepStrictEqual(result.ok, false)
    if (!result.ok) deepStrictEqual(result.error.code, 'schema_changed')
  }
})

Deno.test('Luogu adapter treats an anti-bot challenge as retryable', async () => {
  const transport: LuoguTransport = {
    fetchProfile() {
      return Promise.resolve({
        html: '<html><title>Just a moment...</title><div>challenge-platform</div></html>',
        finalUrl: 'https://www.luogu.com.cn/challenge',
      })
    },
  }

  const result = await createLuoguAdapter({ transport }).sync('123456789')

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'source_unavailable')
  deepStrictEqual(result.error.retryable, true)
})

Deno.test('Luogu adapter treats an unexpected login redirect as retryable', async () => {
  const transport: LuoguTransport = {
    fetchProfile() {
      return Promise.resolve({
        html: '<html><title>Login</title></html>',
        finalUrl: 'https://www.luogu.com.cn/auth/login',
      })
    },
  }

  const result = await createLuoguAdapter({ transport }).sync('123456789')

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'source_unavailable')
  deepStrictEqual(result.error.retryable, true)
})

Deno.test('Luogu adapter maps a public-profile 403 to a retryable source error', async () => {
  const transport: LuoguTransport = {
    fetchProfile() {
      throw new HttpError('Upstream returned HTTP 403', 'source_unavailable', false, 403)
    },
  }

  const result = await createLuoguAdapter({ transport }).sync('123456789')

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'source_unavailable')
  deepStrictEqual(result.error.retryable, true)
  deepStrictEqual(result.error.details, { httpStatus: 403 })
})

Deno.test('Luogu adapter preserves a public-profile 404 as not found', async () => {
  const transport: LuoguTransport = {
    fetchProfile() {
      throw new HttpError('Upstream returned HTTP 404', 'not_found', false, 404)
    },
  }

  const result = await createLuoguAdapter({ transport }).sync('123456789')

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'not_found')
  deepStrictEqual(result.error.retryable, false)
})
