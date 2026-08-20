import type { ReferralSummary } from '../../lib/referrals'

interface AccountReferralSectionProps {
  referralSummary: ReferralSummary | null
  referralLoading: boolean
  referralNotice: string
  copyNotice: string
  onCopy: () => void
}

export function AccountReferralSection({
  referralSummary,
  referralLoading,
  referralNotice,
  copyNotice,
  onCopy,
}: AccountReferralSectionProps) {
  if (!referralSummary?.programEnabled) return null

  return (
    <section className="account-form account-referral-form" aria-labelledby="referral-title">
      <div className="form-section">
        <div className="section-title-row">
          <div>
            <h2 id="referral-title">推荐计划</h2>
            <p>分享邀请码，绑定成功后可获得额外 WebChat 累计额度上限。</p>
          </div>
        </div>
        {referralNotice ? (
          <p className="form-error" role="alert">
            {referralNotice}
          </p>
        ) : null}
        <div className="referral-summary-grid">
          <div className="referral-card">
            <span>我的邀请码</span>
            <strong>{referralLoading ? '读取中' : (referralSummary?.code ?? '--')}</strong>
          </div>
          <div className="referral-card">
            <span>已奖励次数</span>
            <strong>
              {referralLoading ? '读取中' : String(referralSummary?.rewardCount ?? 0) + ' / 10'}
            </strong>
          </div>
          <div className="referral-card">
            <span>累计增加 Token 上限</span>
            <strong>
              {referralLoading
                ? '读取中'
                : (referralSummary?.rewardTokens ?? 0).toLocaleString('zh-CN')}
            </strong>
          </div>
        </div>
        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={referralLoading || !referralSummary?.code || !referralSummary.available}
            onClick={onCopy}
          >
            复制注册链接
          </button>
          <span className="referral-copy-note" aria-live="polite">
            {copyNotice || '新用户可通过链接自动带入邀请码。'}
          </span>
        </div>
        {referralSummary.remainingRewards === 0 ? (
          <p className="account-data-export-note">当前邀请码已达到邀请上限，暂不可继续使用。</p>
        ) : null}
      </div>
    </section>
  )
}
