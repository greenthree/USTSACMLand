const invoke = vi.hoisted(() => vi.fn())

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { triggerAdminFullSync, triggerAdminScopedSync } from './adminOperations'

describe('administrator synchronization requests', () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({
      data: { requested: 3, succeeded: 2, queued: 1, failed: 0 },
      error: null,
    })
  })

  it('sends the member identifier with the Edge Function field name', async () => {
    await expect(
      triggerAdminScopedSync({
        scope: 'member',
        memberId: '8a7c4494-97b0-4c5e-a386-02b0efcf22c7',
      }),
    ).resolves.toEqual({ requested: 3, succeeded: 2, queued: 1, failed: 0 })

    expect(invoke).toHaveBeenCalledWith('sync-stats', {
      body: {
        scope: 'member',
        member_id: '8a7c4494-97b0-4c5e-a386-02b0efcf22c7',
      },
    })
  })

  it('sends the selected platform for platform-wide synchronization', async () => {
    await triggerAdminScopedSync({ scope: 'platform', platform: 'luogu' })

    expect(invoke).toHaveBeenCalledWith('sync-stats', {
      body: { scope: 'platform', platform: 'luogu' },
    })
  })

  it('keeps the existing full synchronization request contract', async () => {
    await triggerAdminFullSync()

    expect(invoke).toHaveBeenCalledWith('sync-stats', {
      body: { scope: 'all' },
    })
  })
})
