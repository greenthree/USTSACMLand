import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminMembersPage } from './AdminMembersPage'

describe('AdminMembersPage', () => {
  it('approves a pending member', async () => {
    const user = userEvent.setup()
    render(<AdminMembersPage />)

    const approveButton = screen.getByRole('button', { name: '批准 沈亦安' })
    const memberRow = approveButton.closest('tr')!
    await user.click(approveButton)
    expect(within(memberRow).getByText('已通过')).toBeInTheDocument()
  })

  it('records a rejection note', async () => {
    const user = userEvent.setup()
    render(<AdminMembersPage />)

    const rejectButton = screen.getByRole('button', { name: '驳回 沈亦安' })
    const memberRow = rejectButton.closest('tr')!
    await user.click(rejectButton)

    const dialog = screen.getByRole('dialog', { name: '驳回 沈亦安' })
    await user.type(
      within(dialog).getByRole('textbox', { name: '驳回原因（可选）' }),
      'QQ 信息需要核验',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认驳回' }))

    expect(within(memberRow).getByText('已驳回')).toBeInTheDocument()
    expect(within(memberRow).getByText('备注：QQ 信息需要核验')).toBeInTheDocument()
  })

  it('requires confirmation before suspending a member', async () => {
    const user = userEvent.setup()
    render(<AdminMembersPage />)

    const suspendButton = screen.getByRole('button', { name: '停用 沈亦安' })
    const memberRow = suspendButton.closest('tr')!
    await user.click(suspendButton)

    const dialog = screen.getByRole('dialog', { name: '停用 沈亦安' })
    expect(within(memberRow).getByText('待审核')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '确认停用' }))

    expect(within(memberRow).getByText('已停用')).toBeInTheDocument()
  })
})
