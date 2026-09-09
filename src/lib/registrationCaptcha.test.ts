import {
  clearRuntimeRegistrationCaptchaOverride,
  getRegistrationCaptchaConfig,
  parseRegistrationCaptchaConfig,
  setRuntimeRegistrationCaptchaEnabled,
} from './registrationCaptcha'

describe('registration CAPTCHA configuration', () => {
  afterEach(() => {
    clearRuntimeRegistrationCaptchaOverride()
  })

  it('allows the runtime server switch to override the build-time flag', () => {
    vi.stubEnv('VITE_REGISTRATION_TURNSTILE_ENABLED', 'true')
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'runtime-site-key')
    setRuntimeRegistrationCaptchaEnabled(false)
    expect(getRegistrationCaptchaConfig()).toEqual({
      enabled: false,
      siteKey: '',
      configurationError: null,
    })
  })

  it('stays disabled by default', () => {
    expect(parseRegistrationCaptchaConfig(undefined, undefined)).toEqual({
      enabled: false,
      siteKey: '',
      configurationError: null,
    })
  })

  it('requires a site key when Turnstile is enabled', () => {
    expect(parseRegistrationCaptchaConfig('true', '  ')).toEqual({
      enabled: true,
      siteKey: '',
      configurationError: '账号安全验证尚未配置完成，请联系管理员。',
    })
  })

  it('accepts an enabled Turnstile configuration', () => {
    expect(parseRegistrationCaptchaConfig(' TRUE ', ' 1x00000000000000000000AA ')).toEqual({
      enabled: true,
      siteKey: '1x00000000000000000000AA',
      configurationError: null,
    })
  })

  it('fails closed on malformed feature flags', () => {
    expect(parseRegistrationCaptchaConfig('yes', 'site-key')).toEqual({
      enabled: false,
      siteKey: '',
      configurationError: '账号安全验证配置无效，请联系管理员。',
    })
  })
})
