import Download from 'lucide-react/dist/esm/icons/download'

interface AccountDataExportSectionProps {
  exportingData: boolean
  disabled: boolean
  exportNotice: string
  exportNoticeKind: 'success' | 'error'
  onExport: () => void
}

export function AccountDataExportSection({
  exportingData,
  disabled,
  exportNotice,
  exportNoticeKind,
  onExport,
}: AccountDataExportSectionProps) {
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
          <button className="secondary-button" type="button" disabled={disabled} onClick={onExport}>
            <Download size={17} aria-hidden="true" />
            {exportingData ? '正在整理数据' : '导出我的数据'}
          </button>
        </div>
      </div>
    </section>
  )
}
