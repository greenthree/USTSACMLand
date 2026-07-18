const firecrawlMocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: firecrawlMocks.invoke } },
}))

import {
  checkAdminFirecrawlKey,
  deleteAdminFirecrawlKey,
  fetchAdminFirecrawlKeys,
  upsertAdminFirecrawlKey,
} from './adminFirecrawlKeys'

const key = {
  id: '00000000-0000-4000-8000-000000000301',
  label: '主额度池',
  keyConfigured: true,
  enabled: false,
  priority: 100,
  healthStatus: 'healthy',
  consecutiveFailures: 0,
  cooldownUntil: null,
  lastSelectedAt: null,
  lastCheckedAt: '2026-07-19T08:00:00.000Z',
  lastSuccessAt: '2026-07-19T08:00:00.000Z',
  lastFailureAt: null,
  lastErrorCode: null,
  creditsRemaining: 409,
  creditsTotal: 1000,
  billingPeriodEnd: '2026-07-24T12:37:07.733Z',
  version: 2,
  createdAt: '2026-07-18T08:00:00.000Z',
  updatedAt: '2026-07-19T08:00:00.000Z',
}

describe('administrator Firecrawl Key client', () => {
  beforeEach(() => firecrawlMocks.invoke.mockReset())

  it('reads only the redacted key projection', async () => {
    firecrawlMocks.invoke.mockResolvedValue({ data: { keys: [key] }, error: null })
    await expect(fetchAdminFirecrawlKeys()).resolves.toEqual([key])
    expect(firecrawlMocks.invoke).toHaveBeenCalledWith('firecrawl-config', {
      body: { action: 'read' },
    })
    expect(JSON.stringify(await fetchAdminFirecrawlKeys())).not.toContain('apiKey')
  })

  it('sends a replacement key once and accepts only redacted response data', async () => {
    firecrawlMocks.invoke.mockResolvedValue({
      data: { key: { ...key, version: 3, healthStatus: 'unknown' } },
      error: null,
    })
    const result = await upsertAdminFirecrawlKey({
      keyId: key.id,
      label: key.label,
      apiKey: 'fc-secret-must-not-echo',
      enabled: false,
      priority: 90,
      expectedVersion: 2,
      reason: '轮换生产 Key',
    })
    expect(firecrawlMocks.invoke).toHaveBeenCalledWith('firecrawl-config', {
      body: {
        action: 'upsert',
        keyId: key.id,
        label: key.label,
        apiKey: 'fc-secret-must-not-echo',
        enabled: false,
        priority: 90,
        expectedVersion: 2,
        reason: '轮换生产 Key',
      },
    })
    expect(JSON.stringify(result)).not.toContain('fc-secret-must-not-echo')
  })

  it('supports one-shot checks and optimistic deletes', async () => {
    firecrawlMocks.invoke
      .mockResolvedValueOnce({
        data: { check: { key, succeeded: true, errorCode: null } },
        error: null,
      })
      .mockResolvedValueOnce({ data: { deletedKeyId: key.id }, error: null })

    await expect(checkAdminFirecrawlKey(key.id)).resolves.toEqual({
      key,
      succeeded: true,
      errorCode: null,
    })
    await expect(deleteAdminFirecrawlKey(key.id, 2, '淘汰失效 Key')).resolves.toBe(key.id)
    expect(firecrawlMocks.invoke).toHaveBeenLastCalledWith('firecrawl-config', {
      body: { action: 'delete', keyId: key.id, expectedVersion: 2, reason: '淘汰失效 Key' },
    })
  })
})
