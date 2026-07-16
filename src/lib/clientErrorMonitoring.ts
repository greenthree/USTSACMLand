export type ClientErrorSurface = 'react_render' | 'window_error' | 'unhandled_rejection'

type ClientErrorCategory = 'type_error' | 'unexpected_error' | 'non_error_throwable'

function clientErrorCategory(error: unknown): ClientErrorCategory {
  if (error instanceof TypeError) return 'type_error'
  if (error instanceof Error) return 'unexpected_error'
  return 'non_error_throwable'
}

export function recordClientRuntimeError(surface: ClientErrorSurface, error: unknown) {
  console.error(
    JSON.stringify({
      version: 1,
      event: 'client_runtime_error',
      surface,
      category: clientErrorCategory(error),
    }),
  )
}

let monitoringInstalled = false

export function installClientRuntimeMonitoring() {
  if (monitoringInstalled) return
  monitoringInstalled = true

  window.addEventListener('error', (event) => {
    recordClientRuntimeError('window_error', event.error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    recordClientRuntimeError('unhandled_rejection', event.reason)
  })
}
