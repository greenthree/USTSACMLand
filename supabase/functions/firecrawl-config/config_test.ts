import { deepStrictEqual, throws } from 'node:assert/strict'
import { parseFirecrawlKey, parseFirecrawlKeys } from './config.ts'

const row = {
  id: '00000000-0000-4000-8000-000000000301',
  label: 'Primary',
  key_configured: true,
  enabled: false,
  priority: 100,
  health_status: 'healthy',
  consecutive_failures: 0,
  cooldown_until: null,
  last_selected_at: null,
  last_checked_at: '2026-07-19T08:00:00.000Z',
  last_success_at: '2026-07-19T08:00:00.000Z',
  last_failure_at: null,
  last_error_code: null,
  credits_remaining: '409',
  credits_total: '1000',
  billing_period_end: '2026-07-24T12:37:07.733Z',
  version: '2',
  created_at: '2026-07-18T08:00:00.000Z',
  updated_at: '2026-07-19T08:00:00.000Z',
}

Deno.test('Firecrawl config parser maps only the redacted administrator projection', () => {
  const parsed = parseFirecrawlKey(row)
  deepStrictEqual(parsed, {
    id: row.id,
    label: 'Primary',
    keyConfigured: true,
    enabled: false,
    priority: 100,
    healthStatus: 'healthy',
    consecutiveFailures: 0,
    cooldownUntil: null,
    lastSelectedAt: null,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: null,
    lastErrorCode: null,
    creditsRemaining: 409,
    creditsTotal: 1000,
    billingPeriodEnd: row.billing_period_end,
    version: 2,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  deepStrictEqual(parseFirecrawlKeys([row]), [parsed])
  deepStrictEqual('apiKey' in parsed, false)
  deepStrictEqual('vaultSecretId' in parsed, false)
})

Deno.test('Firecrawl config parser rejects unknown health states and malformed quotas', () => {
  throws(() => parseFirecrawlKey({ ...row, health_status: 'compromised' }), /invalid data/)
  throws(() => parseFirecrawlKey({ ...row, credits_remaining: '-1' }), /remaining credits/)
  throws(() => parseFirecrawlKeys({ rows: [row] }), /invalid data/)
})
