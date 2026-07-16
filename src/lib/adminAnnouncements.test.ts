const announcementMocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { rpc: announcementMocks.rpc },
}))

import {
  deleteAdminAnnouncement,
  fetchAdminAnnouncements,
  saveAdminAnnouncement,
} from './adminAnnouncements'

describe('administrator announcement operations', () => {
  beforeEach(() => {
    announcementMocks.rpc.mockReset()
  })

  it('maps the cursor-paginated announcement list', async () => {
    announcementMocks.rpc.mockResolvedValue({
      data: [
        {
          announcement_id: '42',
          title: '训练通知',
          body: '周六进行训练。',
          status: 'published',
          published_at: '2026-07-15T08:00:00Z',
          expires_at: null,
          created_by: null,
          created_by_label: null,
          updated_by: 'admin-1',
          updated_by_label: '管理员',
          created_at: '2026-07-15T07:00:00Z',
          updated_at: '2026-07-15T08:00:00Z',
        },
      ],
      error: null,
    })

    await expect(fetchAdminAnnouncements(25, 50)).resolves.toEqual([
      {
        id: 42,
        title: '训练通知',
        body: '周六进行训练。',
        status: 'published',
        publishedAt: '2026-07-15T08:00:00Z',
        expiresAt: null,
        createdBy: null,
        createdByLabel: '系统',
        updatedBy: 'admin-1',
        updatedByLabel: '管理员',
        createdAt: '2026-07-15T07:00:00Z',
        updatedAt: '2026-07-15T08:00:00Z',
      },
    ])
    expect(announcementMocks.rpc).toHaveBeenCalledWith('admin_list_announcements', {
      row_limit: 25,
      before_announcement_id: 50,
    })
  })

  it('sends all editable fields and the optimistic-lock version', async () => {
    announcementMocks.rpc.mockResolvedValue({
      data: [{ announcement_id: 7, announcement_updated_at: '2026-07-15T09:00:00Z' }],
      error: null,
    })

    await expect(
      saveAdminAnnouncement({
        id: 7,
        title: '更新公告',
        body: '更新后的正文',
        status: 'published',
        publishedAt: '2026-07-15T08:00:00Z',
        expiresAt: '2026-07-20T08:00:00Z',
        expectedUpdatedAt: '2026-07-15T07:00:00Z',
      }),
    ).resolves.toEqual({ id: 7, updatedAt: '2026-07-15T09:00:00Z' })

    expect(announcementMocks.rpc).toHaveBeenCalledWith('admin_upsert_announcement', {
      target_announcement_id: 7,
      announcement_title: '更新公告',
      announcement_body: '更新后的正文',
      announcement_status: 'published',
      announcement_published_at: '2026-07-15T08:00:00Z',
      announcement_expires_at: '2026-07-20T08:00:00Z',
      expected_updated_at: '2026-07-15T07:00:00Z',
    })
  })

  it('rejects an empty server version after saving', async () => {
    announcementMocks.rpc.mockResolvedValue({ data: [], error: null })

    await expect(
      saveAdminAnnouncement({
        id: null,
        title: '新公告',
        body: '正文',
        status: 'draft',
        publishedAt: null,
        expiresAt: null,
        expectedUpdatedAt: null,
      }),
    ).rejects.toThrow('服务端未返回公告版本')
  })

  it('requires the delete RPC to confirm deletion', async () => {
    announcementMocks.rpc.mockResolvedValue({ data: false, error: null })

    await expect(deleteAdminAnnouncement(7, '2026-07-15T09:00:00Z')).rejects.toThrow(
      '服务端未确认删除',
    )
    expect(announcementMocks.rpc).toHaveBeenCalledWith('admin_delete_announcement', {
      target_announcement_id: 7,
      expected_updated_at: '2026-07-15T09:00:00Z',
    })
  })

  it('surfaces Supabase RPC errors with operation context', async () => {
    announcementMocks.rpc.mockResolvedValue({ data: null, error: { message: '无权限' } })

    await expect(fetchAdminAnnouncements()).rejects.toThrow('公告列表读取失败：无权限')
  })
})
