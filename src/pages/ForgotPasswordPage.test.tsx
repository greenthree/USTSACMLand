import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const { resetPasswordForEmail } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  demoAuthEnabled: false,
  supabase: {
    auth: { resetPasswordForEmail },
  },
}))

import { ForgotPasswordPage } from './ForgotPasswordPage'

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null })
  })

  it('sends a recovery email back to the reset-password route', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'member@example.com')
    await user.click(screen.getByRole('button', { name: '发送重置邮件' }))

    expect(resetPasswordForEmail).toHaveBeenCalledWith('member@example.com', {
      redirectTo: 'http://localhost:3000/reset-password',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      '如果该邮箱已注册，重置邮件将很快送达。',
    )
  })
})
