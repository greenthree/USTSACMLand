import { render, screen } from '@testing-library/react'
import { AppErrorBoundary } from './AppErrorBoundary'

function BrokenPage(): never {
  throw new TypeError('private render details')
}

describe('AppErrorBoundary', () => {
  it('replaces a broken render with an accessible recovery page', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary>
        <BrokenPage />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('页面暂时无法显示')
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument()
    const monitoringCall = consoleError.mock.calls.find((call) =>
      String(call[0]).includes('client_runtime_error'),
    )
    expect(monitoringCall).toBeDefined()
    expect(String(monitoringCall?.[0])).not.toContain('private render details')
    consoleError.mockRestore()
  })
})
