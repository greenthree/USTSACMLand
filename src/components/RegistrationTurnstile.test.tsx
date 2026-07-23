import { act, render, screen } from '@testing-library/react'
import { RegistrationTurnstile } from './RegistrationTurnstile'

describe('RegistrationTurnstile', () => {
  afterEach(() => {
    delete window.turnstile
  })

  it('forwards verification, expiration and provider errors without retaining a token', async () => {
    const remove = vi.fn()
    let options:
      | {
          callback: (token: string) => void
          'expired-callback': () => void
          'error-callback': () => void
        }
      | undefined
    window.turnstile = {
      render: vi.fn((_container, renderOptions) => {
        options = renderOptions
        return 'widget-1'
      }),
      remove,
    }
    const onTokenChange = vi.fn()
    const { unmount } = render(
      <RegistrationTurnstile
        siteKey="1x00000000000000000000AA"
        resetKey={0}
        onTokenChange={onTokenChange}
      />,
    )

    await act(async () => undefined)
    expect(window.turnstile.render).toHaveBeenCalledOnce()
    expect(onTokenChange).toHaveBeenCalledWith('')

    act(() => options?.callback('verified-token'))
    expect(onTokenChange).toHaveBeenLastCalledWith('verified-token')

    act(() => options?.['expired-callback']())
    expect(onTokenChange).toHaveBeenLastCalledWith('')

    act(() => options?.['error-callback']())
    expect(onTokenChange).toHaveBeenLastCalledWith('')
    expect(screen.getByRole('alert')).toHaveTextContent('安全验证加载失败')

    unmount()
    expect(remove).toHaveBeenCalledWith('widget-1')
  })
})
