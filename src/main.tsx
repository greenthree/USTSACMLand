import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installClientRuntimeMonitoring } from './lib/clientErrorMonitoring'
import { setRuntimeRegistrationCaptchaEnabled } from './lib/registrationCaptcha'
import { supabaseUrl } from './lib/supabase'
import './styles.css'

installClientRuntimeMonitoring()

async function loadRuntimeAuthProtection(): Promise<void> {
  if (import.meta.env.DEV) {
    // Local Supabase and demo sessions must remain usable without a production
    // Turnstile widget or the hosted Auth CAPTCHA secret.
    setRuntimeRegistrationCaptchaEnabled(false)
    return
  }
  if (!supabaseUrl) return
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/auth-captcha-config`,
      {
        headers: { accept: 'application/json' },
      },
    )
    if (!response.ok) return
    const body = (await response.json()) as { config?: { enabled?: unknown } }
    if (typeof body.config?.enabled === 'boolean') {
      setRuntimeRegistrationCaptchaEnabled(body.config.enabled)
    }
  } catch {
    // Keep the build-time setting when runtime configuration is unavailable.
  }
}

async function bootstrap(): Promise<void> {
  await loadRuntimeAuthProtection()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppErrorBoundary>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <App />
        </BrowserRouter>
      </AppErrorBoundary>
    </StrictMode>,
  )
}

void bootstrap()
