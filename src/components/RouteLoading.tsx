import { LoadingState } from './LoadingState'

export function RouteLoading({ label = '正在加载页面' }: { label?: string }) {
  return (
    <div className="page route-loading-page">
      <LoadingState label={label} />
    </div>
  )
}

export function StandaloneRouteLoading() {
  return (
    <main id="main-content" className="simple-auth-page" tabIndex={-1}>
      <RouteLoading />
    </main>
  )
}
