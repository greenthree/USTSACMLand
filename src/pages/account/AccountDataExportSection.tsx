import Download from 'lucide-react/dist/esm/icons/download'
import { useState } from 'react'
import {
  buildDemoPersonalDataExport,
  downloadPersonalDataExport,
  fetchOwnPersonalDataExport,
} from '../../lib/personalDataExport'
import type { Platform } from '../../types/domain'

interface AccountDataExportSectionProps {
  userId?: string
  userEmail?: string
  userRole?: 'member' | 'admin'
  isDemo: boolean
  profile: {
    fullName: string
    qq: string
    grade: string
    major: string
    accounts: Record<Platform, string>
  }
  disabled?: boolean
}

export function AccountDataExportSection({
  userId,
  userEmail,
  userRole,
  isDemo,
  profile,
  disabled = false,
}: AccountDataExportSectionProps) {
  const [exportingData, setExportingData] = useState(false)
  const [exportNotice, setExportNotice] = useState('')
  const [exportNoticeKind, setExportNoticeKind] = useState<'success' | 'error'>('success')

  async function handleDataExport() {
    if (!userId) return

    setExportingData(true)
    setExportNotice('')
    try {
      const exportedData = isDemo
        ? buildDemoPersonalDataExport({
            userId,
            email: userEmail ?? '',
            fullName: profile.fullName,
            qq: profile.qq,
            grade: profile.grade,
            major: profile.major,
            role: userRole ?? 'member',
            accounts: profile.accounts,
          })
        : await fetchOwnPersonalDataExport()
      const filename = downloadPersonalDataExport(exportedData)
      setExportNoticeKind('success')
      setExportNotice(`数据已导出为 ${filename}。`)
    } catch (error) {
      setExportNoticeKind('error')
      setExportNotice(error instanceof Error ? error.message : '个人数据导出失败，请稍后重试。')
    } finally {
      setExportingData(false)
    }
  }

  return (
    <section className="account-form account-data-export" aria-labelledby="data-export-title">
      <div className="form-section">
        <div className="section-title-row">
          <div>
            <h2 id="data-export-title">导出个人数据</h2>
            <p>
              下载版本化 JSON
              文件，包含已保存的账号资料、平台绑定与统计、同步记录、每日一题记录，以及本人私有的 AI
              对话和用量。
            </p>
          </div>
        </div>
        <p className="account-data-export-note">
          文件不会包含密码、登录令牌、服务密钥、管理员身份信息或其他成员数据。
        </p>
        {exportNotice ? (
          <p
            className={`form-${exportNoticeKind} account-export-notice`}
            role={exportNoticeKind === 'error' ? 'alert' : 'status'}
          >
            {exportNotice}
          </p>
        ) : null}
        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={disabled || exportingData || !userId}
            onClick={() => void handleDataExport()}
          >
            <Download size={17} aria-hidden="true" />
            {exportingData ? '正在整理数据' : '导出我的数据'}
          </button>
        </div>
      </div>
    </section>
  )
}
