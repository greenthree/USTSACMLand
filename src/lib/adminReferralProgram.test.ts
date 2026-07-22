const referralProgramMocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabase: { rpc: referralProgramMocks.rpc } }))

import {
  fetchAdminReferralProgramConfig,
  mapAdminReferralProgramConfig,
  updateAdminReferralProgramConfig,
} from './adminReferralProgram'

const configRow = {
  enabled: true,
  version: 4,
  updated_at: '2026-07-22T08:00:00Z',
  updated_by_label: '值班管理员',
  reason: '开放暑期推荐计划',
}

describe('administrator referral program adapter', () => {
  beforeEach(() => referralProgramMocks.rpc.mockReset())

  it('maps the single configuration row and accepts a bigint version string', async () => {
    referralProgramMocks.rpc.mockResolvedValue({
      data: [{ ...configRow, version: '4' }],
      error: null,
    })

    await expect(fetchAdminReferralProgramConfig()).resolves.toEqual({
      enabled: true,
      version: 4,
      updatedAt: configRow.updated_at,
      updatedByLabel: '值班管理员',
      reason: '开放暑期推荐计划',
    })
    expect(referralProgramMocks.rpc).toHaveBeenCalledWith('admin_read_referral_program_config')
  })

  it('normalizes the audit reason and submits an optimistic version', async () => {
    referralProgramMocks.rpc.mockResolvedValue({
      data: [{ ...configRow, enabled: false, version: 5, reason: '暂停活动排查异常' }],
      error: null,
    })

    await expect(
      updateAdminReferralProgramConfig(false, 4, '  暂停活动排查异常  '),
    ).resolves.toMatchObject({ enabled: false, version: 5, reason: '暂停活动排查异常' })
    expect(referralProgramMocks.rpc).toHaveBeenCalledWith('admin_update_referral_program_config', {
      requested_enabled: false,
      expected_version: 4,
      requested_reason: '暂停活动排查异常',
    })
  })

  it('uses system fallbacks for nullable audit fields', () => {
    expect(
      mapAdminReferralProgramConfig([{ ...configRow, updated_by_label: null, reason: null }]),
    ).toMatchObject({ updatedByLabel: '系统', reason: null })
  })

  it('rejects malformed rows and invalid client-side updates', async () => {
    expect(() => mapAdminReferralProgramConfig([])).toThrow(/无效数据/)
    expect(mapAdminReferralProgramConfig([{ ...configRow, version: 0 }]).version).toBe(0)
    expect(() => mapAdminReferralProgramConfig([{ ...configRow, version: -1 }])).toThrow(/无效数据/)
    expect(() =>
      mapAdminReferralProgramConfig([{ ...configRow, updated_at: 'not-a-date' }]),
    ).toThrow(/无效数据/)
    await expect(updateAdminReferralProgramConfig(false, -1, '正常原因')).rejects.toThrow(
      /版本无效/,
    )
    await expect(updateAdminReferralProgramConfig(false, 4, '短')).rejects.toThrow(/3 至 500/)
  })

  it('formats administrator RPC failures without accepting an invalid payload', async () => {
    referralProgramMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'referral_program_version_conflict' },
    })

    await expect(updateAdminReferralProgramConfig(false, 4, '正常停用原因')).rejects.toThrow(
      '推荐计划配置更新失败：referral_program_version_conflict',
    )
  })
})
