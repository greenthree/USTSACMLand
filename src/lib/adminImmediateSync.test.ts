const immediateSyncMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: immediateSyncMocks.invoke } },
}))

import { triggerAdminImmediateSync } from './adminImmediateSync'

describe('admin immediate synchronization', () => {
  beforeEach(() => {
    immediateSyncMocks.invoke.mockReset().mockResolvedValue({
      data: { status: 'succeeded' },
      error: null,
    })
  })

  it('requests all eligible platforms after member approval', async () => {
    await triggerAdminImmediateSync({
      memberId: 'member-1',
      triggerType: 'registration',
    })

    expect(immediateSyncMocks.invoke).toHaveBeenCalledWith('sync-member', {
      body: {
        memberId: 'member-1',
        triggerType: 'registration',
      },
    })
  })

  it('requests only the newly verified platform after account approval', async () => {
    await triggerAdminImmediateSync({
      memberId: 'member-1',
      platforms: ['luogu'],
      triggerType: 'account_changed',
    })

    expect(immediateSyncMocks.invoke).toHaveBeenCalledWith('sync-member', {
      body: {
        memberId: 'member-1',
        platforms: ['luogu'],
        triggerType: 'account_changed',
      },
    })
  })

  it('surfaces a failed 207 response even when invoke has no transport error', async () => {
    immediateSyncMocks.invoke.mockResolvedValue({
      data: {
        status: 'failed',
        results: [{ ok: false, error: { message: '上游限流' } }],
      },
      error: null,
    })

    await expect(
      triggerAdminImmediateSync({ memberId: 'member-1', triggerType: 'registration' }),
    ).rejects.toThrow('上游限流')
  })
})
