# v1.0.0 发布门禁只读审计 - 2026-08-13

本文记录当前 `main` 发布候选的脱敏只读事实，不包含 Token、Cookie、Secret 值、成员身份、
平台账号、日志正文、Firecrawl 作业 ID 或浏览器会话 ID。本轮没有修改生产 Auth、数据库、
Vault、Function Secret、Edge Function、cron、Cloudflare 或 GitHub 设置，也没有创建正式标签。

## 发布候选与自动门禁

- 当前已部署候选：`14e9f2257d51ee3578254ea3a2f1fba3387f1b6c`，即 PR #149 的 merge SHA。
- CI run `31706261357`：`verify` 与 `database-security` 均成功；覆盖 Node 22 依赖安装、
  格式、Lint、单元测试、多浏览器 E2E、生产构建、Edge Function 检查、pgTAP 与并发围栏。
- Secret scan run `31706261269`：成功。
- Pages run `31707162024`：`build`、`deploy` 与 `production-ranking-audit` 均成功；生产榜单
  复算 job 为 `94471191081`。
- `npm run check:repository-readiness -- greenthree/USTSACMLand` 通过：10 个 workflow、
  仓库与 `production-operations` Secret 名称边界、7 个 Actions Variable、Pages 正式地址和
  30 天默认 Actions 保留期均符合契约。检查只读取名称，不读取 Secret 值。
- 当前生产 Supabase 为 `ACTIVE_HEALTHY`：76 个 migration、0 pending、12 个 ACTIVE Edge
  Function、23 个 Function Secret 名称且 0 缺失。严格 readiness 的最近完整独立审计通过；
  本轮两次复查分别在匿名 REST 与 Edge CORS 网络探针上瞬时超时，已通过另一轮成功探针和
  当前主分支 CI 交叉确认，不把网络超时伪装成配置通过，也没有继续反复请求生产接口。

## Edge Function 版本

当前生产版本为：`sync-member` v57、`sync-stats` v38、`delete-account` v21、
`change-password` v19、`webchat-config` v14、`webchat` v27、`webchat-cache-probe` v20、
`firecrawl-config` v9、`webchat-attachment` v2、`webchat-image-cleanup` v2、
`sync-avatar` v1、`member-avatar` v1。除公开头像代理 `member-avatar` 按设计关闭 JWT 验证外，
其余函数均启用 JWT 验证；12 个函数均启用仓库 import map。

本轮没有重新部署函数。PR #149 只更新前端文案、测试和文档，发布顺序中的数据库、Edge
Function 部署不适用；Pages 已由通过 CI 的精确 merge SHA 自动部署。

## 保留窗口与外部服务

- Supabase Dashboard 确认生产项目属于 Free 计划；官方计划资料明确 Free 计划日志可访问最近
  1 天，Pro 为 7 天。Auth、API、Postgres、Storage 与 Edge Function 日志均受该计划窗口
  约束，窗口外不能从 Logs Explorer 恢复；Free 计划不含 Log Drains。
- GitHub API 回读仓库默认 Actions 日志/Artifact 保留期为 30 天；加密数据库备份与隔离
  恢复证据由 workflow 单独限制为 14 天。
- 当前维护 Firecrawl 凭据可用，额度为 `984 / 1000`，即本周期剩余 98%，并发占用为
  `0 / 2`。该检查没有创建 scrape、crawl、browser 或 interact 作业。
- Firecrawl 官方 Browser Sandbox 文档规定会话 TTL 为 30 到 3600 秒；项目每个 QOJ
  attempt 均主动关闭临时会话。当前普通请求默认 `zeroDataRetention=false`，仓库 ADR 也记录
  未启用 ZDR。供应商公开文档与隐私政策没有给出普通作业/账户记录的固定自动删除天数；
  隐私政策只承诺收到书面请求后删除 PII。因此 Firecrawl 固定保留期仍需供应商书面确认，
  不能用 1 小时会话 TTL 代替作业记录保留期。

## 已有证据可以关闭的清单事实

- 最新 Schema v2 加密备份 run `31622577243` 与隔离恢复 run `31622919641` 已成功；当前
  76 个 migration、恢复下限拒绝、Auth/RLS、私有 Storage 清单/哈希和明文清理均有证据。
- 当前 CI 与生产安全证据覆盖管理员 RPC、`_unlimited` 浏览器拒绝、即时升降级、最后管理员
  围栏、旧 JWT、活动同步注销阻断、注销审计匿名化、固定平台样本和 QOJ 一次重试边界。
- 2026-07-26 的真实队员验收已核对姓名、专业、年级、六个平台绑定与统计；当前 Pages 的
  生产榜单复算再次通过。
- 2026-08-12 北京时间 07:42 与 19:46 两个日更调度均成功；下一次候选版本后的周二
  XCPC ELO/QOJ 完整批次为 2026-08-18，发布清单对此继续保持未完成。

## Auth 与 Chrome 只读核验

- Supabase Auth 控制台确认 Email Auth、Confirm email 与 Secure password change 均已开启；
  本轮没有点击保存或修改任何 Auth 设置。
- 使用 Chrome 中现有认证会话，在独立新标签检查 `/`、`/rankings`、`/privacy`、`/register`、
  `/login`、`/account` 与 `/admin`。桌面 1440、移动 390 与宽屏 1920 三种覆盖下，21 个
  路由/视口组合均有可见主内容，页面级横向溢出为 0；390 覆盖下公开页面实际文档宽度为
  375px，账号页和后台为 390px。
- 同一独立标签在重新加载正式首页后没有捕获到 warning 或 error。页面资源清单包含正式
  `ustsacm.png` 与 `icpc-foundation.png`；Chrome 扩展注入的 `data:` favicon 带有
  `data-codex-favicon-badge` 标记，不作为站点图标证据。站点自身图标由 `index.html` 的
  `/favicon-192.png`、Apple touch icon、JSON-LD `/favicon-512.png` 及构建时
  `check-site-metadata.mjs` 门禁核对。
- 榜单键盘焦点顺序和焦点可见性再次只读确认正常；完整首页、登录、注册、认证页面和后台
  键盘证据继续引用 `docs/evidence/keyboard-focus-browser-2026-07-28.md`。

## 隐私说明一致性修复与生产关闭

生产 Supabase 要求完成邮箱确认后才能首次登录，注册成功页也一直要求用户查收确认邮件；
但审计时部署中的 `PRIVACY.md` 对应页面仍写有“注册后账号直接启用”，注册表单说明也暗示可以
立即填写资料。该表述与真实 Auth 配置不一致，因此当时生产隐私一致性门禁不能关闭。

修复分支将仓库隐私说明与站内隐私页改为“注册后需先完成邮箱确认，之后才能登录”，将
更新日期改为 2026 年 8 月 13 日，并把注册页说明改为“完成邮箱确认并登录后”再填写资料。
`PrivacyPage` 与 `RegisterPage` 定向测试共 19 项通过，新增断言同时要求邮箱确认语义存在、
旧“直接启用”文案不存在。该修复已由 PR #149 合并并完成 Pages 发布及生产 Chrome 验收，
生产隐私一致性条目现已关闭。

本地 Chrome 又在 `http://127.0.0.1:5173` 只读走通“注册页 → 隐私说明”导航：桌面隐私页
显示新日期和邮箱确认说明，旧文案不存在且没有 Vite 错误覆盖；390px 覆盖下注册说明正常
换行，文本框位于实际 375px 文档宽度内，页面级横向溢出为 0。本地域名不在生产 Turnstile
Widget 允许列表中，因此注册页按设计出现 Cloudflare `110200` 告警；未尝试 CAPTCHA、注册
或表单提交，不把该预期域名限制记为代码回归。

最终本地门禁使用从 Node.js 官方 `latest-v22.x` 下载并按 `SHASUMS256.txt` 校验的
Node `v22.23.2`：`npm ci` 成功安装 443 个锁定包且审计为 0 漏洞；`npm run format:check`、
`npm run lint`、完整 `npm test`（98 个文件、636 项测试）和 `npm run build` 均通过。构建同时
验证 102 个运行时包的许可证清单、Pages SPA fallback、站点元数据、方形图标和 bundle 预算；
仅保留既有 Assistant 分块超过 Vite 500 kB 提示阈值的非失败警告。

## PR #149 合并、部署与生产验证

- PR #149 的已验证 head 为 `c6cc6d36ebe4189f345d1e02030f931c8b3b3405`，合并提交为
  `14e9f2257d51ee3578254ea3a2f1fba3387f1b6c`。PR 的 `verify`、`database-security` 与
  `gitleaks` 全部成功；没有在检查完成后追加提交。
- `main` CI run `31706261357` 与 Secret scan run `31706261269` 均成功并精确覆盖 merge
  SHA。Pages run `31707162024` 的 build、deploy 和 `production-ranking-audit` 全部成功；
  榜单审计重新计算生产公开排名并通过 3 项检查。
- 使用 Chrome 对正式 `/privacy` 与 `/register` 完成 1440、390 和 1920 三种视口只读复核。
  隐私页显示“更新日期：2026 年 8 月 13 日”和“注册后需先完成邮箱确认，之后才能登录”；
  注册页显示“完成邮箱确认并登录后，可以填写竞赛账号和其他成员资料”。两页旧文案匹配数均
  为 0，页面级横向溢出为 0，控制台没有 warning/error。现有真实登录态只让提交按钮显示
  “已登录”并保持禁用；本轮没有填写或提交表单、取得 CAPTCHA 或发送认证请求。
- `npm run check:cloudflare-domain` 通过：正式域名、旧 Pages 地址跳转、SPA fallback、HTML
  `max-age=600`、指纹资源 `max-age=31536000` 与二次缓存 `HIT` 均符合契约。生产脚本资源已
  切换到本次发布的指纹文件。
- GitHub Rulesets API 确认 `Protect main release branch` 处于 active，匹配默认分支、没有
  bypass actor，当前维护账号也不能绕过；规则要求 PR、分支最新、review thread 解决以及
  `verify`、`database-security`、`gitleaks`，并禁止删除和 non-fast-forward。旧 Branch
  Protection API 返回 `404` 是 Rulesets 仓库的接口差异，不是保护缺失。`github-pages`
  environment 的自定义部署分支策略只允许 `main`。
- 本轮发布只更新 Pages；没有修改 Supabase Auth、数据库、Vault、Secret、Edge Function、
  cron、Cloudflare 配置或成员数据，也没有创建正式版本标签。

## 仍阻塞 v1.0.0

1. **Auth `429` 与窗口恢复。** 2026-08-04 的三次受控请求均为
   `400 / invalid_credentials`；没有观察到 `429`。新的演练需要单独批准临时修改生产 Auth
   `rate_limit_otp`。推荐使用受控新公网 IP、先启动独立 12 分钟 watchdog，将唯一字段从
   `30` 临时改为 `1` 并精确回读；Chrome 每次取得独立有效 Turnstile token，只对不存在的
   `.invalid` 邮箱串行发送错误密码登录，最多 3 次，首次 `429` 即停止。仅在服务端给出可用
   `Retry-After` 时等待该窗口并发送 1 次恢复确认，随后主流程与 watchdog 均幂等恢复原值
   `30`。禁止 `supabase config push`、代理、伪造转发 IP、并发、真实成员凭据、验证码绕过
   和请求洪泛；任一配置回读失败、非预期 5xx 或请求上限到达均立即停止并恢复原配置。
2. **Firecrawl 固定记录保留期。** 需要供应商支持或账户合同给出普通作业/会话记录的固定
   自动删除期限、删除请求能力和不可恢复边界；在得到书面事实前保持发布阻塞。
3. **品牌与标识授权。** Apache-2.0 只覆盖项目原创代码/文档，不授权学校、集训队、ICPC
   等名称和图形标识。项目负责人需要确认实际使用范围具有授权或接受相应法律风险。
4. **候选版本后的周更观察。** 需要观察 2026-08-18 周二 XCPC ELO/QOJ 批次终态；这是
   只读观察，不需要生产写批准。
5. **最终发布决定。** 上述阻塞关闭后，创建带注释的 `v1.0.0` 标签仍需项目负责人单独明确
   批准。不得提前创建、移动或复用标签。

完整受控注销三类失败语义和候选版本单平台同步若要按清单重新执行，会写入生产夹具、推进
恢复下限或访问第三方平台；现有证据足以支持实现边界，但本轮不擅自重放这些高风险验收。

## 2026-08-13 Auth 演练执行结果

- 项目负责人已明确批准：低流量窗口内只把生产 Auth `rate_limit_otp` 从 `30` 临时改为
  `1`，最长 12 分钟；独立 watchdog 恢复 `30`；最多 3 次串行无效 `.invalid` 登录和窗口
  恢复后最多 1 次确认；不修改其他 Auth 配置、Secret、数据库、函数、Pages 或成员数据。
- 预检通过：唯一 linked 项目为 `qzggoqdmsvktrtnjislw`、状态 `ACTIVE_HEALTHY`；Auth
  只读回读为 `rate_limit_otp=30`、Email 开启、邮箱不自动确认、Turnstile 开启且 provider
  为 `turnstile`、Secure password change 开启。
- 恢复 watchdog 在仓库外一次性 Windows 计划任务中实跑成功：独立进程单字段回写
  `rate_limit_otp=30` 并 GET 精确回读，任务结果为成功；随后任务、脚本和状态文件全部删除。
- 按根契约保护真实成员会话：Chrome 当前唯一可用站点标签已处于真实登录态，`/login` 显示
  “已登录”且提交按钮禁用；没有独立未登录 Chrome 会话。Agent 未退出真实账号、未填写表单、
  未取得 CAPTCHA、未发送任何登录请求，也没有触发 `429`。因此本轮不是“429 未出现”，而是
  **在发送请求前失败关闭，演练未通过且不产生结论**。
- 生产配置最终仍为 `rate_limit_otp=30`，Email/Confirm email/Turnstile/Secure password
  change 状态未改变；没有 Auth 用户、Profile、成员数据、Function、Pages、模型、图片或
  WebChat 请求副作用。
- 中止后的只读健康核对：第一次 `npm run check:supabase-preflight` 报告队列最近一次 Edge
  请求未成功完成；没有重放队列或修改生产配置。随后立即运行的严格
  `npm run check:supabase-readiness` 成功，确认 76 个 migration、0 pending、12 个函数、
  23 个 Secret 名称零缺失、Auth email/匿名 REST/Edge 边界和 queue scheduler 全部 ready。
  PITR 与供应商物理备份仍为关闭/0，属于已有加密逻辑备份门禁，不是本次 Auth 操作副作用。

下一次执行前必须先提供维护者控制的、未带真实项目登录态的独立 Chrome 会话，并确认该会话
使用受控新公网 IP；不能通过退出或复用真实成员会话替代。只有在独立会话和 watchdog 都可用
后，才可重新运行批准范围内的单字段限流演练。

## 2026-08-13 取消决定

项目负责人随后明确取消本次生产 Auth `429` 演练。取消后没有创建或启动新的 watchdog，没有修改
`rate_limit_otp` 或其他 Auth 配置，也没有发送登录请求；生产配置继续为 `rate_limit_otp=30`。
因此本次取消不构成 `429` 或恢复窗口的通过证据，发布门禁仍保持未完成。若未来重新进行，必须
重新确认批准范围，并先提供独立未登录 Chrome 会话和受控新公网 IP。
