import { Component, type ReactNode } from 'react'
import { recordClientRuntimeError } from '../lib/clientErrorMonitoring'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  failed: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    recordClientRuntimeError('react_render', error)
  }

  render() {
    if (this.state.failed) {
      return (
        <main id="main-content" className="simple-auth-page app-error-page" tabIndex={-1}>
          <section className="auth-form standalone-form" role="alert">
            <div>
              <h1>页面暂时无法显示</h1>
              <p>客户端发生了未预期错误。请刷新页面；如果问题持续，请联系管理员。</p>
            </div>
            <button
              className="primary-button full-button"
              type="button"
              onClick={() => window.location.reload()}
            >
              刷新页面
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
