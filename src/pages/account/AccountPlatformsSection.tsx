import { PlatformMark } from '../../components/PlatformMark'
import { platformAccountMaxLengths } from '../../lib/platformAccounts'
import { platformLabels } from '../../lib/platforms'
import { platforms, type AccountVerificationStatus, type Platform } from '../../types/domain'

export type AccountDisplayStatus = AccountVerificationStatus | 'missing'

const accountStatusLabels: Record<AccountDisplayStatus, string> = {
  missing: '未绑定',
  pending: '待验证',
  verified: '已验证',
  invalid: '无效',
  disabled: '已停用',
}

function AccountStatusBadge({
  status,
  error,
}: {
  status: AccountDisplayStatus
  error: string | null
}) {
  return (
    <span className={`status status-${status}`} title={error ?? undefined}>
      {accountStatusLabels[status]}
    </span>
  )
}

interface AccountPlatformsSectionProps {
  accounts: Record<Platform, string>
  accountStatuses: Record<Platform, AccountDisplayStatus>
  accountErrors: Record<Platform, string | null>
  accountValidationErrors: Record<string, string | null>
  onAccountChange: (platform: Platform, value: string) => void
  onAccountBlur: (platform: Platform, value: string) => void
  disabled: boolean
}

export function AccountPlatformsSection({
  accounts,
  accountStatuses,
  accountErrors,
  accountValidationErrors,
  onAccountChange,
  onAccountBlur,
  disabled,
}: AccountPlatformsSectionProps) {
  return (
    <fieldset className="form-section" disabled={disabled}>
      <div className="section-title-row">
        <div>
          <h2>平台绑定</h2>
          <p>牛客和洛谷填写 UID（个人主页链接最后的一串数字）；XCPC ELO 使用姓名和学校自动匹配。</p>
        </div>
      </div>
      <div className="platform-form-list">
        {platforms.map((platform) => {
          if (platform === 'xcpc_elo') {
            return (
              <div className="platform-form-row platform-auto-match-row" key={platform}>
                <PlatformMark platform={platform} />
                <span className="platform-field-label">姓名匹配</span>
                <span className="platform-auto-match-value" aria-label="XCPC ELO 姓名匹配">
                  按「姓名 + 苏州科技大学」自动匹配
                </span>
                <AccountStatusBadge
                  status={accounts[platform] ? accountStatuses[platform] : 'missing'}
                  error={accountErrors[platform]}
                />
              </div>
            )
          }

          return (
            <label className="platform-form-row" key={platform}>
              <PlatformMark platform={platform} />
              <span className="platform-field-label">
                {platform === 'nowcoder' || platform === 'luogu' ? 'UID' : '账号 ID'}
              </span>
              <input
                aria-label={`${platformLabels[platform]} 账号`}
                aria-invalid={accountValidationErrors[platform] ? 'true' : undefined}
                aria-describedby={
                  accountValidationErrors[platform]
                    ? `platform-${platform}-validation-error`
                    : undefined
                }
                autoCapitalize="none"
                inputMode={platform === 'nowcoder' || platform === 'luogu' ? 'numeric' : 'text'}
                maxLength={platformAccountMaxLengths[platform]}
                spellCheck={false}
                value={accounts[platform]}
                onChange={(event) => onAccountChange(platform, event.target.value)}
                onBlur={(event) => onAccountBlur(platform, event.target.value)}
              />
              <AccountStatusBadge
                status={accounts[platform] ? accountStatuses[platform] : 'missing'}
                error={accountErrors[platform]}
              />
              {accountValidationErrors[platform] ? (
                <span
                  className="platform-validation-error"
                  id={`platform-${platform}-validation-error`}
                >
                  {accountValidationErrors[platform]}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
