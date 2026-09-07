import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmModal } from './ConfirmModal'

describe('ConfirmModal', () => {
  it('does not render dialog content when closed', () => {
    render(
      <ConfirmModal
        open={false}
        title="确认删除"
        description="此操作不可撤销"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders modal dialog and triggers callbacks on button clicks', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()
    const handleCancel = vi.fn()

    render(
      <ConfirmModal
        open={true}
        title="确认归档目标"
        description="归档后仍会保留历史记录。"
        confirmText="确认归档"
        danger={true}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />,
    )

    expect(screen.getByRole('dialog', { name: '确认归档目标' })).toBeInTheDocument()
    expect(screen.getByText('归档后仍会保留历史记录。')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: '确认归档' })
    expect(confirmBtn).toHaveClass('danger-button')

    await user.click(confirmBtn)
    expect(handleConfirm).toHaveBeenCalledTimes(1)

    const cancelBtn = screen.getByRole('button', { name: '取消' })
    await user.click(cancelBtn)
    expect(handleCancel).toHaveBeenCalledTimes(1)
  })

  it('closes dialog and calls onCancel on Escape key press', async () => {
    const user = userEvent.setup()
    const handleCancel = vi.fn()

    render(
      <ConfirmModal
        open={true}
        title="确认操作"
        description="测试按键交互"
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />,
    )

    await user.keyboard('{Escape}')
    expect(handleCancel).toHaveBeenCalledTimes(1)
  })
})
