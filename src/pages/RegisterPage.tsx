import UserPlus from 'lucide-react/dist/esm/icons/user-plus'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { AuthContextPanel } from '../components/AuthContextPanel'
import { RegistrationTurnstile } from '../components/RegistrationTurnstile'
import {
  checkReferralCodeAvailability,
  normalizeReferralCode,
  referralCodeError,
  referralCodeLength,
} from '../lib/referrals'
import { getRegistrationCaptchaConfig } from '../lib/registrationCaptcha'

type ReferralProgramState = 'checking' | 'enabled' | 'paused' | 'unavailable'

export function RegisterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { signUp, status, user } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [referralCode, setReferralCode] = useState(() =>
    normalizeReferralCode(searchParams.get('invite') ?? ''),
  )
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [referralProgramState, setReferralProgramState] = useState<ReferralProgramState>('checking')
  const referralStatusRequestIdRef = useRef(0)
  const captchaConfig = getRegistrationCaptchaConfig()

  const loadReferralProgramState = useCallback(async () => {
    const requestId = ++referralStatusRequestIdRef.current
    try {
      const result = await checkReferralCodeAvailability()
      if (requestId !== referralStatusRequestIdRef.current) return
      setReferralProgramState(result.programEnabled ? 'enabled' : 'paused')
    } catch {
      if (requestId !== referralStatusRequestIdRef.current) return
      setReferralProgramState('unavailable')
    }
  }, [])

  useEffect(() => {
    void loadReferralProgramState()

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadReferralProgramState()
    }
    const refreshOnFocus = () => void loadReferralProgramState()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshOnFocus)

    return () => {
      referralStatusRequestIdRef.current += 1
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [loadReferralProgramState])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setSubmitting(true)
    let captchaSubmitted = false

    try {
      const normalizedFullName = fullName.trim()
      if (!normalizedFullName) {
        setError('请输入姓名。')
        return
      }
      const submittedReferralCode = referralProgramState === 'enabled' ? referralCode : ''
      const invitationError = referralCodeError(submittedReferralCode)
      if (invitationError) {
        setError(invitationError)
        return
      }
      if (captchaConfig.configurationError) {
        setError(captchaConfig.configurationError)
        return
      }
      if (captchaConfig.enabled && !captchaToken) {
        setError('请先完成注册安全验证。')
        return
      }

      captchaSubmitted = captchaConfig.enabled
      const signedIn = captchaConfig.enabled
        ? await signUp(normalizedFullName, email, password, submittedReferralCode, captchaToken)
        : await signUp(normalizedFullName, email, password, submittedReferralCode)
      if (signedIn) {
        navigate('/account', { replace: true })
        return
      }
      setMessage('账号已创建，但当前认证配置仍要求邮箱验证；验证后即可登录。')
    } catch (signUpError) {
      setError(signUpError instanceof Error ? signUpError.message : '注册失败，请稍后重试。')
    } finally {
      if (captchaSubmitted) {
        setCaptchaToken('')
        setCaptchaResetKey((value) => value + 1)
      }
      setSubmitting(false)
    }
  }

  return (
    <main id="main-content" className="auth-page" tabIndex={-1}>
      <AuthContextPanel mode="register" />
      <section className="auth-form-section">
        <form className="auth-form" onSubmit={handleSubmit}>
          <div>
            <h2>创建账号</h2>
            <p>注册后直接填写竞赛账号和其他成员资料。</p>
          </div>
          <label>
            <span>姓名</span>
            <input
              type="text"
              autoComplete="name"
              maxLength={64}
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </label>
          <label>
            <span>邮箱</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span id="register-password-label">密码</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              aria-labelledby="register-password-label"
              aria-describedby="register-password-help"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <small id="register-password-help">至少 8 位，不要与其他网站共用。</small>
          </label>
          {referralProgramState === 'enabled' ? (
            <label>
              <span id="register-referral-label">邀请码（选填）</span>
              <input
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={referralCodeLength}
                spellCheck={false}
                aria-labelledby="register-referral-label"
                aria-describedby="register-referral-help"
                value={referralCode}
                onChange={(event) => setReferralCode(normalizeReferralCode(event.target.value))}
              />
              <small id="register-referral-help">通过成员分享链接进入时会自动填写。</small>
            </label>
          ) : null}
          {captchaConfig.enabled && captchaConfig.siteKey ? (
            <RegistrationTurnstile
              siteKey={captchaConfig.siteKey}
              resetKey={captchaResetKey}
              onTokenChange={setCaptchaToken}
            />
          ) : null}
          {captchaConfig.configurationError ? (
            <p className="form-error" role="alert">
              {captchaConfig.configurationError}
            </p>
          ) : null}
          {message ? (
            <p className="form-success" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="primary-button full-button"
            type="submit"
            disabled={
              submitting ||
              status === 'unavailable' ||
              Boolean(user) ||
              Boolean(captchaConfig.configurationError) ||
              (captchaConfig.enabled && !captchaToken)
            }
          >
            <UserPlus size={17} aria-hidden="true" />
            {user ? '已登录' : submitting ? '注册中' : '注册'}
          </button>
          <p className="centered-link">
            已有账号？<Link to="/login">返回登录</Link>
          </p>
          <p className="auth-legal">
            注册前请阅读<Link to="/privacy">隐私说明</Link>
          </p>
        </form>
      </section>
    </main>
  )
}
