const personalExportMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { rpc: personalExportMocks.rpc },
}))

import {
  buildDemoPersonalDataExport,
  downloadPersonalDataExport,
  fetchOwnPersonalDataExport,
  personalDataExportFilename,
} from './personalDataExport'

describe('personal data export', () => {
  beforeEach(() => {
    personalExportMocks.rpc.mockReset()
  })

  it('loads only the target-free own-data RPC result', async () => {
    const payload = { schemaVersion: 1, profile: { fullName: '测试成员' } }
    personalExportMocks.rpc
      .mockResolvedValueOnce({ data: payload, error: null })
      .mockResolvedValueOnce({ data: [], error: null })

    await expect(fetchOwnPersonalDataExport()).resolves.toEqual({
      ...payload,
      trainingGoals: [],
    })
    expect(personalExportMocks.rpc).toHaveBeenCalledWith('export_own_data')
    expect(personalExportMocks.rpc).toHaveBeenCalledWith('export_own_training_goals')
  })

  it('fails closed for RPC errors and invalid payloads', async () => {
    personalExportMocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: new Error('database detail'),
      })
      .mockResolvedValueOnce({ data: [], error: null })
    await expect(fetchOwnPersonalDataExport()).rejects.toThrow('个人数据导出失败，请稍后重试。')

    personalExportMocks.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    await expect(fetchOwnPersonalDataExport()).rejects.toThrow('个人数据导出失败，请稍后重试。')
  })

  it('builds a bounded demo export without inventing private history', () => {
    const payload = buildDemoPersonalDataExport(
      {
        userId: 'demo-member',
        email: 'demo@example.test',
        fullName: '演示成员',
        qq: '12345678',
        grade: '24级',
        major: '计算机科学与技术',
        role: 'member',
        accounts: {
          codeforces: 'DemoHandle',
          nowcoder: '',
          atcoder: '',
          xcpc_elo: '',
          luogu: '',
          qoj: '',
        },
      },
      new Date('2026-07-19T05:00:00.000Z'),
    ) as Record<string, unknown>

    expect(payload.schemaVersion).toBe(1)
    expect(payload.exportedAt).toBe('2026-07-19T05:00:00.000Z')
    expect(payload.platformAccounts).toEqual([
      expect.objectContaining({ platform: 'codeforces', externalId: 'DemoHandle' }),
    ])
    expect(payload.webchat).toEqual(expect.objectContaining({ conversations: [] }))
  })

  it('downloads a timestamped JSON file and revokes its object URL', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:personal-data')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const exportedAt = new Date('2026-07-19T05:06:07.890Z')
    const filename = downloadPersonalDataExport({ schemaVersion: 1 }, exportedAt)

    expect(filename).toBe('usts-acm-land-personal-data_2026-07-19_05-06-07-890Z.json')
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:personal-data')

    click.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('uses filesystem-safe UTC filenames', () => {
    expect(personalDataExportFilename(new Date('2026-07-19T05:06:07.890Z'))).toBe(
      'usts-acm-land-personal-data_2026-07-19_05-06-07-890Z.json',
    )
  })
})
