import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { RouteErrorBoundary } from './RouteErrorBoundary'

function ProblematicChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('测试渲染异常')
  }
  return <div>正常内容</div>
}

describe('RouteErrorBoundary', () => {
  const originalError = console.error
  beforeAll(() => {
    console.error = vi.fn()
  })
  afterAll(() => {
    console.error = originalError
  })

  it('renders children when no error occurs', () => {
    render(
      <RouteErrorBoundary>
        <ProblematicChild shouldThrow={false} />
      </RouteErrorBoundary>,
    )
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })

  it('catches render error, displays friendly alert, and allows retry', async () => {
    const user = userEvent.setup()

    function Wrapper() {
      const [shouldThrow, setShouldThrow] = useState(true)
      return (
        <div>
          <button type="button" onClick={() => setShouldThrow(false)}>
            修复错误
          </button>
          <RouteErrorBoundary>
            <ProblematicChild shouldThrow={shouldThrow} />
          </RouteErrorBoundary>
        </div>
      )
    }

    render(<Wrapper />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('页面暂时无法显示')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '修复错误' }))
    const retryBtn = screen.getByRole('button', { name: '重试' })
    await user.click(retryBtn)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })

  it('automatically resets error when resetKey changes', () => {
    const { rerender } = render(
      <RouteErrorBoundary resetKey="/page-1">
        <ProblematicChild shouldThrow={true} />
      </RouteErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(
      <RouteErrorBoundary resetKey="/page-2">
        <ProblematicChild shouldThrow={false} />
      </RouteErrorBoundary>,
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })
})
