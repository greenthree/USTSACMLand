import { Component, type ReactNode } from 'react'
import { recordClientRuntimeError } from '../lib/clientErrorMonitoring'

interface RouteErrorBoundaryProps {
  children: ReactNode
  resetKey?: string
}

interface RouteErrorBoundaryState {
  hasError: boolean
  error: Error | null
  prevResetKey?: string
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    hasError: false,
    error: null,
    prevResetKey: this.props.resetKey,
  }

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { hasError: true, error }
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    if (props.resetKey !== state.prevResetKey) {
      return {
        hasError: false,
        error: null,
        prevResetKey: props.resetKey,
      }
    }
    return null
  }

  componentDidCatch(error: Error) {
    recordClientRuntimeError('react_render', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="route-error-card" role="alert">
          <h2>页面暂时无法显示</h2>
          <p>渲染当前页面时发生了未预期错误。你可以重试，或通过上方导航前往其他页面。</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            重试
          </button>
        </section>
      )
    }

    return this.props.children
  }
}
