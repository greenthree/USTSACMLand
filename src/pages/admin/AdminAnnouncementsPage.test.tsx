import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminAnnouncement } from '../../types/domain'

const announcementMocks = vi.hoisted(() => ({
  deleteAnnouncement: vi.fn(),
  fetchAnnouncements: vi.fn(),
  saveAnnouncement: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

vi.mock('../../lib/adminAnnouncements', () => ({
  deleteAdminAnnouncement: announcementMocks.deleteAnnouncement,
  fetchAdminAnnouncements: announcementMocks.fetchAnnouncements,
  saveAdminAnnouncement: announcementMocks.saveAnnouncement,
}))

import { AdminAnnouncementsPage } from './AdminAnnouncementsPage'

const publishedAnnouncement: AdminAnnouncement = {
  id: 12,
  title: '暑期训练安排',
  body: '周六上午进行专题训练。',
  status: 'published',
  publishedAt: '2026-07-15T08:00:00Z',
  expiresAt: null,
  createdBy: 'admin-1',
  createdByLabel: '管理员',
  updatedBy: 'admin-1',
  updatedByLabel: '管理员',
  createdAt: '2026-07-15T07:00:00Z',
  updatedAt: '2026-07-15T08:00:00Z',
}

const draftAnnouncement: AdminAnnouncement = {
  ...publishedAnnouncement,
  id: 11,
  title: '新生题单整理中',
  body: '尚未发布。',
  status: 'draft',
  publishedAt: null,
  updatedAt: '2026-07-15T07:30:00Z',
}

describe('AdminAnnouncementsPage with Supabase configured', () => {
  beforeEach(() => {
    announcementMocks.deleteAnnouncement.mockReset().mockResolvedValue(undefined)
    announcementMocks.fetchAnnouncements
      .mockReset()
      .mockResolvedValue([publishedAnnouncement, draftAnnouncement])
    announcementMocks.saveAnnouncement
      .mockReset()
      .mockResolvedValue({ id: 13, updatedAt: '2026-07-15T10:00:00Z' })
  })

  it('loads and filters announcements by stored status', async () => {
    const user = userEvent.setup()
    render(<AdminAnnouncementsPage />)

    expect(await screen.findByRole('row', { name: /暑期训练安排/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /新生题单整理中/ })).toBeInTheDocument()
    expect(announcementMocks.fetchAnnouncements).toHaveBeenCalledWith(51)

    await user.selectOptions(screen.getByRole('combobox', { name: '公告状态' }), 'draft')
    expect(screen.queryByRole('row', { name: /暑期训练安排/ })).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /新生题单整理中/ })).toBeInTheDocument()
  })

  it('loads the next page with the last visible announcement ID', async () => {
    const user = userEvent.setup()
    const firstPage = Array.from({ length: 51 }, (_, index) => ({
      ...draftAnnouncement,
      id: 100 - index,
      title: `公告 ${100 - index}`,
    }))
    announcementMocks.fetchAnnouncements
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ ...draftAnnouncement, id: 50, title: '公告 50' }])

    render(<AdminAnnouncementsPage />)

    await screen.findByRole('button', { name: '加载更多公告' })
    expect(screen.queryByRole('row', { name: /公告 50/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '加载更多公告' }))

    expect(await screen.findByRole('row', { name: /公告 50/ })).toBeInTheDocument()
    expect(announcementMocks.fetchAnnouncements).toHaveBeenLastCalledWith(51, 51)
  }, 15_000)

  it('creates an archived announcement without inventing a publication time', async () => {
    const user = userEvent.setup()
    render(<AdminAnnouncementsPage />)

    await screen.findByRole('row', { name: /暑期训练安排/ })
    await user.click(screen.getByRole('button', { name: '新建公告' }))
    const dialog = screen.getByRole('dialog', { name: '新建公告' })
    await user.type(within(dialog).getByRole('textbox', { name: /标题/ }), '归档备忘')
    await user.type(within(dialog).getByRole('textbox', { name: /正文/ }), '仅保留在后台。')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '状态' }), 'archived')
    await user.click(within(dialog).getByRole('button', { name: '保存公告' }))

    expect(announcementMocks.saveAnnouncement).toHaveBeenCalledWith({
      id: null,
      title: '归档备忘',
      body: '仅保留在后台。',
      status: 'archived',
      publishedAt: null,
      expiresAt: null,
      expectedUpdatedAt: null,
    })
    expect(await screen.findByRole('status')).toHaveTextContent('公告已创建。')
  })

  it('edits with the current version and refreshes that version after a conflict', async () => {
    const user = userEvent.setup()
    const refreshedAnnouncement = {
      ...publishedAnnouncement,
      updatedAt: '2026-07-15T09:00:00Z',
    }
    announcementMocks.fetchAnnouncements
      .mockResolvedValueOnce([publishedAnnouncement])
      .mockResolvedValue([refreshedAnnouncement])
    announcementMocks.saveAnnouncement
      .mockRejectedValueOnce(new Error('公告保存失败：版本冲突'))
      .mockResolvedValueOnce({ id: 12, updatedAt: '2026-07-15T10:00:00Z' })

    render(<AdminAnnouncementsPage />)

    await screen.findByRole('row', { name: /暑期训练安排/ })
    await user.click(screen.getByRole('button', { name: '编辑公告 暑期训练安排' }))
    const dialog = screen.getByRole('dialog', { name: '编辑公告' })
    const title = within(dialog).getByRole('textbox', { name: /标题/ })
    await user.clear(title)
    await user.type(title, '更新后的训练安排')
    await user.click(within(dialog).getByRole('button', { name: '保存公告' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('版本冲突')
    await user.click(within(dialog).getByRole('button', { name: '保存公告' }))

    expect(announcementMocks.saveAnnouncement).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 12,
        expectedUpdatedAt: '2026-07-15T09:00:00Z',
      }),
    )
  })

  it('rejects an expiry time that is not later than publication', async () => {
    const user = userEvent.setup()
    render(<AdminAnnouncementsPage />)

    await screen.findByRole('row', { name: /暑期训练安排/ })
    await user.click(screen.getByRole('button', { name: '新建公告' }))
    const dialog = screen.getByRole('dialog', { name: '新建公告' })
    await user.type(within(dialog).getByRole('textbox', { name: /标题/ }), '定时公告')
    await user.type(within(dialog).getByRole('textbox', { name: /正文/ }), '时间校验。')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '状态' }), 'published')
    await user.clear(within(dialog).getByLabelText('发布时间'))
    await user.type(within(dialog).getByLabelText('发布时间'), '2026-07-20T08:00')
    await user.type(within(dialog).getByLabelText('过期时间（可选）'), '2026-07-19T08:00')
    await user.click(within(dialog).getByRole('button', { name: '保存公告' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('过期时间必须晚于发布时间')
    expect(announcementMocks.saveAnnouncement).not.toHaveBeenCalled()
  })

  it('confirms deletion before removing an announcement', async () => {
    const user = userEvent.setup()
    render(<AdminAnnouncementsPage />)

    await screen.findByRole('row', { name: /暑期训练安排/ })
    await user.click(screen.getByRole('button', { name: '删除公告 暑期训练安排' }))
    const dialog = screen.getByRole('dialog', { name: '删除公告' })
    expect(dialog).toHaveTextContent('无法撤销')
    await user.click(within(dialog).getByRole('button', { name: '确认删除' }))

    expect(announcementMocks.deleteAnnouncement).toHaveBeenCalledWith(12, '2026-07-15T08:00:00Z')
    await waitFor(() =>
      expect(screen.queryByRole('row', { name: /暑期训练安排/ })).not.toBeInTheDocument(),
    )
  })

  it('traps focus in the editor and restores the trigger on Escape', async () => {
    const user = userEvent.setup()
    render(<AdminAnnouncementsPage />)

    await screen.findByRole('row', { name: /暑期训练安排/ })
    const trigger = screen.getByRole('button', { name: '新建公告' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '新建公告' })
    const close = within(dialog).getByRole('button', { name: '关闭公告编辑对话框' })
    const save = within(dialog).getByRole('button', { name: '保存公告' })
    close.focus()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(save)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('shows a protected empty state when the live list fails', async () => {
    announcementMocks.fetchAnnouncements.mockRejectedValue(new Error('公告列表读取失败：无权限'))

    render(<AdminAnnouncementsPage />)

    expect(await screen.findByText('公告列表读取失败：无权限')).toHaveAttribute('role', 'status')
    expect(screen.getByText('暂无匹配公告')).toBeInTheDocument()
  })
})
