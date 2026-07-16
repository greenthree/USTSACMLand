import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({
  supabase: null,
}))

import { AdminSyncPage } from './AdminSyncPage'

describe('AdminSyncPage in local demonstration mode', () => {
  it('initializes the visible member selection so its sync action is enabled', async () => {
    const user = userEvent.setup()
    render(<AdminSyncPage />)

    const button = screen.getByRole('button', { name: '同步该成员' })
    expect(button).toBeEnabled()

    await user.click(button)
    expect(screen.getByRole('dialog', { name: '同步指定成员' })).toHaveTextContent(
      '将同步 周知行 的全部已验证平台账号。',
    )
  })
})
