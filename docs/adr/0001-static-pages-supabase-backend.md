# ADR 0001：GitHub Pages 静态前端与 Supabase 服务端分离

- 状态：已接受
- 日期：2026-07-14

## 背景

USTSACMLand 既是公开的集训队官网，也包含邮箱认证、私有成员资料、管理员操作和需要第三方凭据的数据同步。GitHub Pages 只能托管静态文件，不能安全保存密码、Cookie、CSRF Token 或 service role key，也不能执行定时抓取。

## 决策

采用三层部署边界：

1. GitHub Pages 托管 Vite 构建后的 React SPA，只包含公开资源、Supabase 项目 URL 和 anon key。
2. Supabase 托管 Auth、Postgres、RLS、数据库函数和 Edge Functions。
3. GitHub Actions 负责 CI、Pages 发布和按计划调用受保护的同步入口。

浏览器不得直接访问 Codeforces、牛客、AtCoder、XCPC ELO、洛谷或 QOJ 的服务端抓取凭据。第三方查询由 Edge Functions 完成，浏览器只读取经过 RLS 和公开视图过滤后的数据库快照。

生产发布顺序为：

1. 应用数据库 migration。
2. 部署与新 Schema 兼容的 Edge Functions。
3. 构建并发布静态前端。

GitHub Pages 使用自定义域名 `https://ustsacm.fun/` 的根路径。构建后复制 `index.html` 为 `404.html`，保证刷新 SPA 深层路由时仍回到前端路由器。旧 `greenthree.github.io/USTSACMLand/` 地址由 GitHub Pages 自动跳转到自定义域名。

## 安全边界

- `VITE_*` 变量会进入浏览器包，只允许放公开配置。
- `SUPABASE_SERVICE_ROLE_KEY` 只允许存在于 GitHub Actions Secrets 和受控服务端环境。
- Edge Functions 必须验证 JWT/调用角色；前端路由守卫只改善体验，不构成权限边界。
- 数据库 migration 采用前向修复。已应用的 migration 不修改历史文件来“回滚”。

## 后果

优点：

- 公开页面可以使用 GitHub Pages 免费稳定托管。
- 认证、RLS、审计和抓取凭据不进入静态包。
- Pages、数据库和同步函数可以独立部署和排障。

代价：

- 一次完整发布跨 GitHub 与 Supabase 两个平台。
- Schema、Edge Function 和前端必须保持向前/向后兼容的部署顺序。
- GitHub Pages 无法提供服务端渲染，SEO 依赖静态元数据而不是逐页动态 HTML。

## 未采用方案

- 在 GitHub Actions 中直接抓取并提交 JSON：会把运行状态与数据快照耦合到 Git，难以提供账号权限、审计和即时同步。
- 在浏览器中抓取第三方网站：会暴露凭据并受到 CORS、WAF 和用户网络环境影响。
- 立即自建全栈服务器：当前运维成本高于项目规模；未来若 Edge Function 时限或浏览器自动化成为硬约束，可新增 ADR 迁移。

## 回滚与验证

- Pages：回退到已知可用提交并重新运行部署工作流。
- Edge Functions：从已知可用提交重新部署函数。
- 数据库：编写纠正 migration，不执行破坏性历史回滚。
- CI 必须通过格式、lint、单元测试、生产构建、Edge Function 检查和空库 migration/pgTAP 后，才视为完整发布候选。
