import { useEffect, useRef, useState } from 'react'

const turnstileScriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const turnstileScriptSelector = 'script[data-usts-turnstile="true"]'

interface TurnstileRenderOptions {
  sitekey: string
  theme: 'auto'
  size: 'flexible'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let turnstileLoadPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (turnstileLoadPromise) return turnstileLoadPromise

  turnstileLoadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(turnstileScriptSelector)
    const script = existingScript ?? document.createElement('script')

    const handleLoad = () => {
      if (window.turnstile) {
        resolve(window.turnstile)
        return
      }
      turnstileLoadPromise = null
      reject(new Error('Turnstile API did not initialize.'))
    }
    const handleError = () => {
      turnstileLoadPromise = null
      reject(new Error('Turnstile script failed to load.'))
    }

    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })
    if (!existingScript) {
      script.src = turnstileScriptUrl
      script.async = true
      script.defer = true
      script.dataset.ustsTurnstile = 'true'
      document.head.append(script)
    }
  })

  return turnstileLoadPromise
}

interface RegistrationTurnstileProps {
  siteKey: string
  resetKey: number
  onTokenChange: (token: string) => void
}

export function RegistrationTurnstile({
  siteKey,
  resetKey,
  onTokenChange,
}: RegistrationTurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbackRef = useRef(onTokenChange)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    callbackRef.current = onTokenChange
  }, [onTokenChange])

  useEffect(() => {
    let cancelled = false
    let api: TurnstileApi | null = null
    let widgetId: string | null = null

    callbackRef.current('')
    setLoadError(false)

    void loadTurnstile()
      .then((loadedApi) => {
        if (cancelled || !containerRef.current) return
        api = loadedApi
        widgetId = loadedApi.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'auto',
          size: 'flexible',
          callback: (token) => callbackRef.current(token),
          'expired-callback': () => callbackRef.current(''),
          'error-callback': () => {
            callbackRef.current('')
            setLoadError(true)
          },
        })
      })
      .catch(() => {
        if (!cancelled) {
          callbackRef.current('')
          setLoadError(true)
        }
      })

    return () => {
      cancelled = true
      if (api && widgetId) api.remove(widgetId)
    }
  }, [resetKey, siteKey])

  return (
    <div className="registration-captcha" aria-label="注册安全验证">
      <div ref={containerRef} />
      {loadError ? (
        <p className="registration-captcha-error" role="alert">
          安全验证加载失败，请检查网络后刷新页面重试。
        </p>
      ) : null}
    </div>
  )
}
