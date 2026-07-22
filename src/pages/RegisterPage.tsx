import UserPlus from 'lucide-react/dist/esm/icons/user-plus'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { SiteLogo } from '../components/SiteLogo'
import {
  checkReferralCodeAvailability,
  normalizeReferralCode,
  referralCodeError,
  referralCodeLength,
} from '../lib/referrals'

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
  const [referralProgramState, setReferralProgramState] = useState<ReferralProgramState>('checking')
  const referralStatusRequestIdRef = useRef(0)

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

    try {
      const normalizedFullName = fullName.trim()
      if (!normalizedFullName) {
        setError('请输入姓名。')
        return
      }
      const submittedReferralCode = referralProgramState === 'paused' ? '' : referralCode
      const invitationError = referralCodeError(submittedReferralCode)
      if (invitationError) {
        setError(invitationError)
        return
      }

      const signedIn = await signUp(normalizedFullName, email, password, submittedReferralCode)
      if (signedIn) {
        navigate('/account', { replace: true })
        return
      }
      setMessage('账号已创建，但当前认证配置仍要求邮箱验证；验证后即可登录。')
    } catch (signUpError) {
      setError(signUpError instanceof Error ? signUpError.message : '注册失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main id="main-content" className="auth-page" tabIndex={-1}>
      <section className="auth-context">
        <div className="auth-context-inner">
          <SiteLogo className="auth-logo" />
          <h1>USTS ACM Land</h1>
          <p>苏州科技大学 ACM 集训队</p>
          <dl>
            <div>
              <dt>6</dt>
              <dd>数据平台</dd>
            </div>
            <div>
              <dt>8</dt>
              <dd>核心指标</dd>
            </div>
          </dl>
        </div>
      </section>
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
          {referralProgramState === 'paused' ? (
            <p className="auth-inline-notice" role="status">
              推荐计划已暂停，不使用邀请码仍可正常注册。
            </p>
          ) : (
            <>
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
                <small id="register-referral-help">
                  {referralProgramState === 'checking'
                    ? '正在确认推荐计划状态。'
                    : referralProgramState === 'unavailable'
                      ? '提交时会再次验证；不填写邀请码仍可正常注册。'
                      : '通过成员分享链接进入时会自动填写。'}
                </small>
              </label>
              {referralProgramState === 'unavailable' ? (
                <p className="auth-inline-notice" role="status">
                  邀请码状态暂时无法确认，填写邀请码时必须在提交前验证成功。
                </p>
              ) : null}
            </>
          )}
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
            disabled={submitting || status === 'unavailable' || Boolean(user)}
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
