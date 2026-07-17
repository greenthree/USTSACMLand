const invoke = vi.hoisted(() => vi.fn())

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { triggerAdminFullSync, triggerAdminScopedSync } from './adminOperations'

describe('administrator synchronization requests', () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({
      data: { requested: 3, succeeded: 2, queued: 1, failed: 0, nextCursor: null },
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
        batch_size: 6,
      },
    })
  })

  it('sends the selected platform for platform-wide synchronization', async () => {
    await triggerAdminScopedSync({ scope: 'platform', platform: 'luogu' })

    expect(invoke).toHaveBeenCalledWith('sync-stats', {
      body: { scope: 'platform', platform: 'luogu', batch_size: 6 },
    })
  })

  it('keeps the existing full synchronization request contract', async () => {
    await triggerAdminFullSync()

    expect(invoke).toHaveBeenCalledWith('sync-stats', {
      body: { scope: 'all', batch_size: 6 },
    })
  })

  it('aggregates every cursor page for a full synchronization', async () => {
    invoke
      .mockResolvedValueOnce({
        data: { requested: 6, succeeded: 5, queued: 1, failed: 0, nextCursor: 42 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { requested: 2, succeeded: 1, queued: 0, failed: 1, nextCursor: null },
        error: null,
      })

    await expect(triggerAdminFullSync()).resolves.toEqual({
      requested: 8,
      succeeded: 6,
      queued: 1,
      failed: 1,
    })
    expect(invoke).toHaveBeenNthCalledWith(1, 'sync-stats', {
      body: { scope: 'all', batch_size: 6 },
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'sync-stats', {
      body: { scope: 'all', batch_size: 6, cursor: 42 },
    })
  })

  it('rejects a repeated continuation cursor instead of looping forever', async () => {
    invoke.mockResolvedValue({
      data: { requested: 6, succeeded: 6, queued: 0, failed: 0, nextCursor: 42 },
      error: null,
    })

    await expect(triggerAdminFullSync()).rejects.toThrow('同步分页游标未继续前进')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
