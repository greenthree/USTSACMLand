import { describe, expect, it } from 'vitest'
import { runRecoveryTokenPreflight, validateRecoveryTokenShape } from './check-recovery-token.mjs'

describe('recovery token preflight', () => {
  it('rejects missing, classic, and unknown token formats without exposing values', () => {
    expect(() => validateRecoveryTokenShape('')).toThrow(
      /DELETION_RECOVERY_GITHUB_TOKEN is not set/,
    )
    expect(() => validateRecoveryTokenShape('ghp_secret-value')).toThrow(/fine-grained token/)
    expect(() => validateRecoveryTokenShape('gho_secret-value')).toThrow(/fine-grained token/)
    expect(() => validateRecoveryTokenShape('ghs_secret-value')).toThrow(/fine-grained token/)
    expect(() => validateRecoveryTokenShape('ghr_secret-value')).toThrow(/fine-grained token/)
    expect(() => validateRecoveryTokenShape('opaque-token')).toThrow(/fine-grained token/)
  })

  it('rejects a repository override', async () => {
    await expect(
      runRecoveryTokenPreflight({ token: 'github_pat_test', repository: 'someone/else' }),
    ).rejects.toThrow('RECOVERY_GITHUB_REPOSITORY must be greenthree/USTSACMLand.')
  })

  it('reads, writes the identical recovery floor, and confirms it without logging the value', async () => {
    const calls: Array<{ path: string; method: string; body?: string }> = []
    const floor = '2026-07-23T12:25:33.401Z'
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname
      calls.push({
        path,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? init.body : undefined,
      })
      if (path === '/repos/greenthree/USTSACMLand') {
        return new Response(JSON.stringify({ full_name: 'greenthree/USTSACMLand' }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ name: 'BACKUP_RECOVERY_NOT_BEFORE', value: floor }), {
        status: 200,
      })
    }

    const report = await runRecoveryTokenPreflight({ token: 'github_pat_test', fetchImpl })
    expect(report.valueConfirmed).toBe(true)
    expect(calls.map((call) => call.method)).toEqual(['GET', 'GET', 'PATCH', 'GET'])
    expect(calls[2]?.body).toBe(
      JSON.stringify({ name: 'BACKUP_RECOVERY_NOT_BEFORE', value: floor }),
    )
    expect(JSON.stringify(report)).not.toContain(floor)
  })

  it('fails closed when the read-back differs', async () => {
    let reads = 0
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname
      if (path === '/repos/greenthree/USTSACMLand') {
        return new Response(JSON.stringify({ full_name: 'greenthree/USTSACMLand' }), {
          status: 200,
        })
      }
      if (init.method === 'PATCH') return new Response('{}', { status: 200 })
      reads += 1
      const value = reads === 1 ? '2026-07-23T12:25:33.401Z' : '2026-07-23T12:25:34.401Z'
      return new Response(JSON.stringify({ name: 'BACKUP_RECOVERY_NOT_BEFORE', value }), {
        status: 200,
      })
    }

    await expect(
      runRecoveryTokenPreflight({ token: 'github_pat_test', fetchImpl }),
    ).rejects.toThrow('Recovery variable write could not be confirmed.')
  })
})
