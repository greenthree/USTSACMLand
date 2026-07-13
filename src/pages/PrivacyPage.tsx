export function PrivacyPage() {
  return (
    <div className="page legal-page">
      <header className="legal-heading">
        <p className="legal-kicker">USTS ACM Land</p>
        <h1>隐私说明</h1>
        <p>说明成员账号、公开榜单和第三方数据同步涉及的数据范围。</p>
        <small>更新日期：2026 年 7 月 13 日</small>
      </header>

      <article className="legal-body">
        <section>
          <h2>收集的数据</h2>
          <p>
            注册时使用邮箱和密码。认证由 Supabase Auth
            处理，本项目不读取或保存密码明文。成员资料包括姓名、QQ、年级、专业和竞赛平台账号；同步服务还会保存公开的
            Rating、通过题数、更新时间和错误状态。
          </p>
        </section>

        <section>
          <h2>公开范围</h2>
          <p>
            姓名、年级和专业填写完整后，已验证的平台账号、Rating、通过题数和数据更新时间会显示在公开页面。邮箱、QQ、密码、登录令牌和后台审计详情不进入公开榜单。
          </p>
        </section>

        <section>
          <h2>数据用途</h2>
          <ul>
            <li>确认集训队成员身份并管理平台绑定。</li>
            <li>生成队内 Rating 榜、刷题榜和成员详情。</li>
            <li>执行定时同步、故障诊断、安全审计和滥用防护。</li>
          </ul>
        </section>

        <section>
          <h2>第三方服务</h2>
          <p>
            GitHub Pages 托管静态前端，Supabase
            提供认证、数据库和服务端函数。同步时会使用成员填写的平台账号查询
            Codeforces、牛客、AtCoder、XCPC ELO、洛谷和 QOJ 的公开数据；牛客回退查询和 QOJ
            临时登录使用 Firecrawl。各服务对请求数据的处理同时受其自身政策约束。
          </p>
        </section>

        <section>
          <h2>修改与删除</h2>
          <p>
            成员可以在“我的资料”中更正资料和平台账号；平台账号变更后需要重新验证。需要停用账号、删除资料或处理错误绑定时，请通过集训队内部渠道联系管理员。为保障安全和追踪管理操作，必要的审计记录及备份可能在业务数据删除后继续保留一段时间。
          </p>
        </section>

        <section>
          <h2>安全边界</h2>
          <p>
            本项目仅用于集训队训练与展示，不是学校统一身份系统。请勿复用其他网站的密码，也不要在平台账号字段中填写
            Cookie、Token 或其他秘密。若发现数据泄露或越权问题，请不要在公开 Issue
            中附带敏感信息，应通过 GitHub 私密漏洞报告或集训队内部渠道联系维护者。
          </p>
        </section>
      </article>
    </div>
  )
}
