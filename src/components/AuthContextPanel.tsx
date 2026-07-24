import Activity from 'lucide-react/dist/esm/icons/activity'
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right'
import ScanLine from 'lucide-react/dist/esm/icons/scan-line'
import Terminal from 'lucide-react/dist/esm/icons/terminal'
import { SiteLogo } from './SiteLogo'

interface AuthContextPanelProps {
  mode: 'login' | 'register'
}

export function AuthContextPanel({ mode }: AuthContextPanelProps) {
  return (
    <section className="auth-context" aria-label="USTS ACM Land 站点信息">
      <div className="auth-context-grid" aria-hidden="true" />
      <div className="auth-context-orbit auth-context-orbit--one" aria-hidden="true" />
      <div className="auth-context-orbit auth-context-orbit--two" aria-hidden="true" />
      <div className="auth-context-inner">
        <div className="auth-context-topline">
          <span className="auth-context-topline-mark">
            <Activity size={14} aria-hidden="true" />
          </span>
          <span>USTS / ACM · FIELD NOTE</span>
          <span className="auth-context-status">ONLINE</span>
        </div>

        <SiteLogo className="auth-logo" />
        <div className="auth-context-kicker">
          <span>SUZHOU UNIVERSITY OF SCIENCE AND TECHNOLOGY</span>
          <span>2026 / 01</span>
        </div>
        <h1>USTS ACM Land</h1>
        <p className="auth-context-school">苏州科技大学 ACM 集训队</p>

        <div className="auth-context-manifesto">
          <span className="auth-context-manifesto-index">01</span>
          <div>
            <p>{mode === 'login' ? '继续你的训练记录' : '从这里开始训练'}</p>
            <strong>
              把最难的题
              <br />
              <em>留给自己。</em>
            </strong>
          </div>
          <ArrowUpRight className="auth-context-manifesto-arrow" size={22} aria-hidden="true" />
        </div>

        <div className="auth-context-rail" aria-label="集训队平台状态">
          <div>
            <ScanLine size={15} aria-hidden="true" />
            <span>PLATFORM</span>
            <strong>训练数据在线</strong>
          </div>
          <div>
            <Terminal size={15} aria-hidden="true" />
            <span>MODE</span>
            <strong>{mode === 'login' ? '成员登录' : '创建成员账号'}</strong>
          </div>
          <div>
            <span className="auth-context-rail-dot" aria-hidden="true" />
            <span>STATUS</span>
            <strong>READY</strong>
          </div>
        </div>

        <div className="auth-context-footer" aria-hidden="true">
          <span>ALGORITHM</span>
          <span>TEAMWORK</span>
          <span>CONTEST</span>
          <span className="auth-context-footer-line" />
        </div>
      </div>
    </section>
  )
}
