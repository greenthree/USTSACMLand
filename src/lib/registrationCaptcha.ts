export interface RegistrationCaptchaConfig {
  enabled: boolean
  siteKey: string
  configurationError: string | null
}

export function parseRegistrationCaptchaConfig(
  enabledValue: string | undefined,
  siteKeyValue: string | undefined,
): RegistrationCaptchaConfig {
  const normalizedFlag = enabledValue?.trim().toLowerCase() ?? ''
  const siteKey = siteKeyValue?.trim() ?? ''
  const enabled = normalizedFlag === 'true'

  if (normalizedFlag && normalizedFlag !== 'true' && normalizedFlag !== 'false') {
    return {
      enabled: false,
      siteKey: '',
      configurationError: '注册安全验证配置无效，请联系管理员。',
    }
  }

  if (enabled && !siteKey) {
    return {
      enabled: true,
      siteKey: '',
      configurationError: '注册安全验证尚未配置完成，请联系管理员。',
    }
  }

  return { enabled, siteKey, configurationError: null }
}

export function getRegistrationCaptchaConfig(): RegistrationCaptchaConfig {
  return parseRegistrationCaptchaConfig(
    import.meta.env.VITE_REGISTRATION_TURNSTILE_ENABLED,
    import.meta.env.VITE_TURNSTILE_SITE_KEY,
  )
}
