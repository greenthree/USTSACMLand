# USTSACMLand 开发路线图

最后更新：2026-08-11（Asia/Shanghai）

本路线图只保留仍需执行的工作和当前生产基线，不再把已经完成的每次迁移、测试数量和历史烟测逐条堆在主文档中。详细实现记录放在 `README.md`、`docs/evidence/`、`docs/operations-runbook.md` 和 GitHub Pull Request 中。

勾选规则：

- `[x]`：功能已部署到生产，并完成与风险相匹配的验收。
- `[ ]`：仍需开发、配置、生产烟测或人工确认。
- 已开发但仍缺生产配置或验收的能力，不提前标记为完成。

## 1. 产品范围

USTSACMLand 的定位是苏州科技大学 ACM 集训队官网，当前产品范围包括：

- 集训队与算法竞赛介绍、赛事介绍、学习资源和加入方式。
- 每日一题、完成记录和成员讨论。
- Codeforces、牛客、AtCoder、XCPC ELO Rating 榜。
- Codeforces、牛客、AtCoder、洛谷、QOJ 刷题榜与增量榜。
- 成员注册、登录、密码找回、资料维护、平台绑定和个人数据导出。
- 管理员成员管理、平台账号管理、同步管理、手工数据维护、数据源健康和审计。
- 训练目标，以及围绕现有训练、榜单和成员管理能力的维护改进。

### 明确取消的未来用户功能

以下尚未上线的用户功能从路线图移除，不再开发：

- WebChat / AI 学习助手，包括图片输入、视觉模型、缓存探针、成员额度和历史会话的后续产品开发。
- 推荐计划，包括邀请码、绑定、奖励额度、全局开关重开和生产并发验收。
- CF / AtCoder Rating 曲线。
- CF / AtCoder 比赛明细。
- 过题明细浏览。
- 题目难度分布和标签统计。
- 连续活跃天数。
- 比赛提醒、群机器人播报、战队训练计划和移动端原生应用。

个人数据导出已经上线，不属于待开发功能。WebChat 与推荐计划的既有前端、Edge Function、数据库 migration、测试和安全实现全部保留，不删除、不回滚，但退出当前及未来产品范围。生产保持关闭，只有项目负责人未来明确重新立项后，才允许恢复开发或进行重开验收。

## 2. 当前生产基线

- [x] GitHub Pages 已发布 React SPA，支持子路径资源、深链刷新和生产榜单审计。
- [x] Supabase Auth、Postgres、RLS、12 个 Edge Function 和 75 个生产 migration 已部署；除公开头像代理 `member-avatar` 按设计关闭 JWT 验证外，其余函数均启用 JWT 验证，12 个函数的 import map、浏览器 CORS/后台拒绝边界及同步调度已通过生产只读检查。推荐计划与 WebChat 成员入口继续关闭，遗留图片数据库与函数安全基础保留。证据见 [`docs/evidence/supabase-ten-function-readiness-2026-07-26.md`](./docs/evidence/supabase-ten-function-readiness-2026-07-26.md) 与 [`docs/evidence/agent-cold-start-handoff-audit-2026-08-09.md`](./docs/evidence/agent-cold-start-handoff-audit-2026-08-09.md)。
- [x] 邮箱注册、密码登录、真实邮箱找回密码、修改密码和会话恢复流程可用。
- [x] 成员资料、年级、专业联想、QQ、六个平台绑定和 XCPC ELO 姓名自动匹配已上线。
- [x] Rating 榜、刷题榜、周榜、月榜和自定义时间范围增量榜已上线。
- [x] 日更平台每天北京时间 07:00 / 19:00 更新；XCPC ELO 与 QOJ 每周二 08:00 更新。
- [x] 管理员成员管理、账号验证、手工同步、手工分数/题数维护、审计和数据源健康页已上线。
- [x] Firecrawl 多 Key 后台、Vault 存储、启停、优先级、额度检查、冷却和轮换逻辑已部署；生产真实 Key 已录入。
- [x] 每日一题、完成/撤销、讨论、审核和后台题目生命周期已上线。
- [x] WebChat 的历史实现曾完成当前模型、累计成员限额、私有历史、刷新恢复和“思考中”等能力；现已作为遗留模块停止产品开发并保持生产关闭，代码与安全边界继续保留。
- [x] 个人数据导出已上线，并通过真实成员归属和敏感字段生产烟测；证据见 `docs/evidence/personal-data-export-production-2026-07-20.md`。
- [x] 加密数据库备份与隔离恢复演练已完成；证据见 `docs/evidence/database-restore-drill-2026-07-19.md`。

## 3. v1.0.0 发布前必须完成

### P0：同步可靠性

- [x] 所有平台同步在首次失败后最多自动重试一次。生产证据见 `docs/evidence/sync-single-retry-production-2026-07-20.md`。
  - 覆盖 Codeforces、牛客、AtCoder、XCPC ELO、洛谷和 QOJ；该需求取代原先“QOJ 禁止自动重试”的同步策略。
  - 每个平台一次逻辑同步最多执行两个队列 attempt（首次 + 一次重试），不能形成无限重试或多层任务重试；适配器内部的分页和有界 HTTP 恢复仍由各数据源契约控制。
  - 只重试可恢复错误，例如网络失败、超时、临时限流和临时上游不可用。
  - `not_found`、账号格式错误、认证凭据失效、结构变化、权限拒绝和数据校验失败不自动重试。
  - 第二次仍失败时写入最终失败状态，并在后台同步中心与数据源健康页展示；保留最后成功统计，不得写成 0。
  - 两次尝试必须复用同一逻辑任务身份并保持幂等，旧 worker 不能覆盖新 attempt。
  - 本项只适用于平台数据同步；WebChat、中转站兼容性检查和其他付费 AI 请求继续禁止自动重试。
- [x] 使用已录入的生产 Firecrawl Key 完成额度检查、启用状态、轮换/冷却以及牛客和 QOJ 真实烟测。两把数据库 Key 均已配置、启用、逐一检查为健康且有可用额度，受控冷却/轮换与牛客 Firecrawl 回退已验证；`sync-member` v50 的 QOJ 生产烟测在首次 attempt 成功，写入有效题数且没有安排重试，函数日志确认临时会话清理成功。证据见 `docs/evidence/firecrawl-production-readiness-2026-07-22.md` 与 `docs/evidence/firecrawl-qoj-production-smoke-2026-07-24.md`。
- [x] 完成 QOJ 密码错误、反爬 Challenge 页面分类、Firecrawl 限流和会话清理的受控生产演练。真实 QOJ 成功烟测与错误密码演练均确认会话清理成功；错误密码被归类为不可重试的 `auth_expired`，不会安排第二次 attempt。Firecrawl 官方没有 Challenge/`429` 专用测试模式；已用严格限定为 3 次会话创建的受控检查观察到 `200/200/429`，并立即成功清理前两次会话，没有访问 QOJ 或使用请求洪泛。Challenge 检查使用真实 Browser Sandbox 执行受控合成页面，由生产解析器归类为可重试的 `source_unavailable`，随后清理成功；它验证的是页面识别、错误分类和清理路径，不宣称人为触发了 QOJ 的真实 Cloudflare 防护。清理事件只用本站内部 `syncRunId` 关联，不记录 Firecrawl 会话 ID、账号或响应正文。证据见 `docs/evidence/firecrawl-qoj-production-smoke-2026-07-24.md`。
- [x] 完成单平台停机演练，确认其他平台继续更新、失败平台保留最后成功值且只重试一次。
  - 本地空库与受控生产组合演练分别通过 `npm run check:sync-platform-outage` 和 `npm run check:sync-platform-outage:production` 完成；生产模式不暂停 cron、不调用全局领取 RPC，只原子领取随机夹具的唯一 Codeforces 重试任务，并使用不访问第三方的合成 Codeforces 故障与 AtCoder 成功适配器，覆盖首次排队、第二次最终失败、无第三次 attempt、统计/快照保留、公开投影、响应丢失清理对账和 cron 持续可用。2026-07-25 安全复核版已再次通过，证据见 `docs/evidence/sync-platform-outage-production-2026-07-24.md`。

### P0：账号与权限收尾

- [x] 真实邮箱找回密码已完成：生产邮件、回调、重置页面、新密码登录和旧会话失效流程可用。
- [x] 注销恢复凭据已轮换为只授权 `greenthree/USTSACMLand` 的 `Variables: Read and write` Fine-grained Token；GitHub 强制的 Metadata 保持只读，没有 Contents、Administration 或其他额外权限。无回显原值回写/回读预检、Supabase Secret 覆盖、生产 Edge 自主恢复下限前推、随机临时成员真实自助注销和 Auth/Profile/租约/关联夹具零残留核对均通过；证据见 `docs/evidence/account-deletion-fine-grained-token-production-2026-07-25.md`。
- [x] 注销的 Storage / 受控约束 `409`、双连接锁、旧 JWT RLS 和响应丢失对账测试已完成。Auth/Profile 双重只读对账与真实双连接锁等待已加入 CI；只有两者均明确不存在才确认成功，状态分裂或查询失败保持失败关闭。通用 Storage 围栏覆盖 `storage.objects.owner` 与 `owner_id`，并通过共享 Auth 行锁消除了上传/删除竞态；生产 Storage 阻断、清理后成功注销和零残留核对均已通过。2026-07-25 使用一次性 Secret 门控的临时包装器，在生产最终删除 RPC 已提交后主动丢弃响应，函数通过 Auth/Profile 对账返回 HTTP `200`，没有执行第二次兜底注销；恢复正式函数后的完整生产注销耗时为 `6502 ms`。临时钩子未提交，临时 Secret 已删除，正式 `delete-account` 版本 18 为 `ACTIVE`。证据见 `docs/evidence/account-deletion-reconciliation-2026-07-23.md`、`docs/evidence/account-deletion-storage-fence-local-2026-07-23.md`、`docs/evidence/account-deletion-storage-fence-production-2026-07-23.md` 与 `docs/evidence/account-deletion-response-loss-production-2026-07-25.md`。
- [x] 生产 RLS、管理员交接和最小权限最终复核已完成。可复跑的 `npm run check:production-security` 在当前生产 schema 下完成 47 项真实检查：访客、普通成员、停用成员、管理员与 service role 边界；提升/降级对已签发 JWT 的即时生效；管理员成员资料授权与审计表、`_unlimited`、Firecrawl/WebChat 运行时密钥 RPC 拒绝；WebChat 会话、训练目标和图片基础跨成员隔离；图片函数匿名/普通成员拒绝、私有 Bucket、全站暂停、Storage 账目一致及夹具零残留；注销后旧 JWT 失效及 Auth/Profile/任务/审计引用零残留。正式站点 64 个 JavaScript 分块与当前服务端 Supabase Key 值及常见 Token 格式比对均无泄露，最终运行 `cleanupFallbacks=0`、`cleanupConfirmed=true`。证据见 `docs/evidence/production-security-final-audit-2026-07-25.md` 与 `docs/evidence/webchat-image-foundation-production-2026-07-25.md`。

### P1：生产验证

- [x] 使用真实队员完成一轮生产验证，逐项核对姓名、专业、平台绑定、Rating、题数、同步时间和数据状态；私有账号页、公开成员详情、六个平台绑定与 freshness、独立榜单重算均一致，Codeforces 与 AtCoder 官方公开接口复核也完全匹配。证据见 [`docs/evidence/real-member-production-validation-2026-07-26.md`](./docs/evidence/real-member-production-validation-2026-07-26.md)。
- [x] 使用真实认证成员完成 `/account`、`/assistant`、`/training-goals`、`/daily-problem` 和 `/rankings` 的桌面端、390px 移动端、刷新保持、页面级横向溢出、地标、跳转链接、交互控件名称和静态焦点结构复核；五个路由均保持登录、无页面级横向溢出且控制台无 warning/error。证据见 [`docs/evidence/authenticated-responsive-accessibility-production-2026-07-26.md`](./docs/evidence/authenticated-responsive-accessibility-production-2026-07-26.md)。
- [x] 使用真实浏览器完成 Tab / Shift+Tab 焦点顺序与焦点可见性验收。2026-07-28 Chrome 已完成生产首页、新手入门、榜单、登录和注册页的桌面端前向/反向焦点检查及 390px 移动导航修复复验；2026-07-29 又使用真实管理员会话检查账号页、训练目标、每日一题、榜单和后台，确认动态控件焦点顺序、父级 `:focus-within` 焦点环、学习/账号菜单 Enter 与 Escape 行为均正常。管理员后台继续显示遗留 WebChat 配置页用于维护关闭状态，成员主导航和普通用户页面不显示入口。项目不再把人工屏幕阅读器验收纳入发布范围；现有语义结构、键盘操作和自动化可访问性回归继续保留。证据见 [`docs/evidence/keyboard-focus-browser-2026-07-28.md`](./docs/evidence/keyboard-focus-browser-2026-07-28.md)。

### P2：发布治理

- [x] 项目负责人已选择 Apache License 2.0（SPDX 标识符：`Apache-2.0`），维护 Agent 已加入根目录 `LICENSE`。该许可证覆盖项目原创源代码，以及未附带其他授权声明的原创文档和配置；学校、集训队、赛事标识、第三方素材、成员数据和平台数据仍保持独立授权边界。
- [x] 确认同步巡检、数据库备份、凭据轮换、回滚和管理员操作可以由全新上下文 Agent 仅根据仓库文档冷启动执行。2026-08-09 全新上下文 Agent 完整阅读根契约与专项手册，在不触发生产写操作的前提下完成 GitHub/Supabase 冷启动核对、同步队列巡检、备份连续性检查及前端、Edge Function、数据库和 Cloudflare 回滚桌面推演；同时识别并修复仓库级 Secret 与 `production-operations` Environment Secret 的检查口径偏差。证据见 [`docs/evidence/agent-cold-start-handoff-audit-2026-08-09.md`](./docs/evidence/agent-cold-start-handoff-audit-2026-08-09.md)。
- [ ] 按 `docs/release-checklist.md` 完成最终检查并创建 `v1.0.0` 标签。2026-07-29 已通过仓库就绪检查、全仓库 ESLint、七项工作流结构门禁、93 个 Vitest 文件共 596 项测试、10 个函数入口 Deno 类型检查、136 个文件 Deno Lint、462 项 Edge Function 测试、生产构建和 Cloudflare 指纹资源长期缓存门禁；Supabase 已关闭邮箱自动确认并启用服务端 Turnstile CAPTCHA，preflight 与严格就绪检查均通过。全新真实邮箱的有效 token 注册、确认邮件、确认前登录拒绝、重复确认安全性、确认后密码登录和带独立 Turnstile 的自助注销已经完成；注销后的 Auth、Profile 及 19 类关联数据均为 0，再次登录返回标准凭据拒绝。两组各不超过 30 次的生产限流检查均安全停止但未触发 `429`。2026-08-04 又将登录/注册限额临时从 `30` 降至 `2`，等待 30 秒并严格限制为三次请求后仍只得到 `400 / invalid_credentials`；这表明动态降阈值没有立即收缩当前 IP 的旧令牌桶余额，配置已恢复为 `30`，不能把结果记作恢复通过。冷启动交接验收已于 2026-08-09 完成；仍缺维护窗口内可复现的受控 `429` 窗口恢复、当前 `main` Schema v2 备份恢复演练，以及 Supabase 日志与 Firecrawl 保留窗口核验，因此暂不创建标签。证据见 [`docs/evidence/release-gates-2026-07-28.md`](./docs/evidence/release-gates-2026-07-28.md)、[`docs/evidence/registration-abuse-production-gap-2026-07-28.md`](./docs/evidence/registration-abuse-production-gap-2026-07-28.md)、[`docs/evidence/auth-rate-limit-recovery-production-2026-08-04.md`](./docs/evidence/auth-rate-limit-recovery-production-2026-08-04.md) 与 [`docs/evidence/agent-cold-start-handoff-audit-2026-08-09.md`](./docs/evidence/agent-cold-start-handoff-audit-2026-08-09.md)。

### PR #146 合并前审查整改

本节记录当前分支的仓库整改状态，不使用生产完成复选框；“仓库已完成”只表示实现与本地验证完成，不能替代上文 `[x]` 所要求的生产部署和验收。

- 仓库已完成：清理退役 WebChat / 图片输入文档中的开启、付费烟测、非空对象开放验收和遗留中转站凭据轮换指令；历史契约只记录停止时的实现与安全边界，任何重新立项继续要求项目负责人另行批准。
- 仓库已完成：Dependabot 报告的 4 条高危开发依赖告警已由 PR #147 修复，包括 `postcss` 的 `GHSA-r28c-9q8g-f849` 和 `brace-expansion` 的 `GHSA-mh99-v99m-4gvg` / `GHSA-rgw5-rvv9-x895`；2026-08-09 通过 GitHub API 复核开放告警、高危告警和严重告警均为 0，当前完整测试与生产构建通过。
- 仓库已完成：为 Pages 生产 bundle 生成并分发可复现的第三方运行时依赖许可证清单，补齐已跟踪品牌素材的独立授权说明，并在构建门禁中验证许可证文件存在且不为空。构建现按 Vite 实际模块图生成 102 个唯一运行时包的 `THIRD_PARTY_LICENSES.txt`，并逐字分发根 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`；17 项专项测试和完整生产构建通过。品牌与素材的实际授权仍须由项目负责人确认，本项不把软件许可证声明当作品牌授权。
- 仓库已完成：修复许可证门禁对实际进入 bundle 的 `devDependency` 和部分未映射 `node_modules` 模块的漏报，并让独立 `licenses:check` 重新生成只读 Vite 模块图，对账完整包集合，拒绝被删节或生成后已变化的报告；负向回归测试覆盖 bundled dev、未锁定模块、删节报告和 bundle 变化。
- 仓库已完成：移除 `use-composed-ref@1.4.0` 许可补充材料中从其他包推断的版权归属；现仅记录该精确 npm 包与源码 tag 的 MIT 声明、标准许可条款，以及上游未提供 LICENSE 文件或版权声明的事实，不再制造未经上游确认的版权行。
- 仓库已完成：修复仓库就绪检查的组织级 Actions Secret 分页漏检，并让缺少 `production-operations` Environment 时返回可操作的失败信息；已补齐分页、缺失 Environment 和失败信息回归测试，readiness 专项 14 项通过。
- 仓库已完成：统一公开隐私页与关闭态产品行为，不再承诺当前没有成员入口的单会话删除操作，明确 180 天自动清理、个人数据导出和永久注销边界；隐私页与默认关闭路由共 21 项测试通过。
- 仓库已完成：阻止普通成员绕过已隐藏的 WebChat 界面直接调用 own-history 写 RPC 创建或修改遗留会话；新增 migration 撤销 `public`、`anon`、`authenticated` 与 `service_role` 对创建、重命名、归档和消息 upsert 的执行权限，同时保留本人历史读取/删除、个人导出、180 天清理和注销级联边界。当前 51 个 pgTAP 文件、1247 项断言通过；生产 migration 尚未应用，仍须项目负责人单独批准后部署。
- 仓库已完成：将管理员 WebChat 配置与成员 AI 权限界面收紧为只读关闭态，禁止通过站内后台修改中转站、模型、Key、预算、请求开关、成员授权或额度；`webchat-config` 的合法更新请求固定返回 `410 feature_retired`，同时保留关闭状态和历史用量诊断。管理员界面专项 20 项、Edge Function 专项 15 项、全量 Deno 477 项测试通过，并已完成桌面、390px 与宽屏 Chrome 验收；Pages 与 Edge Function 生产部署仍须另行授权。
- 仓库已完成：同步 CI 回归到 WebChat 只读关闭态断言，并修复 WebKit 移动学习章节导航与邀请码注册页的异步时序；移动端锚点即时定位、当前章节导航同步收回，E2E 轮询最终可见几何状态并为低速路由加载保留充分等待，相关 WebKit 重复测试 20/20 通过。

## 4. v1.0.0 发布后接入 Cloudflare

默认方案是继续使用 GitHub Pages 作为静态源站，由 Cloudflare 提供自定义域名、DNS、CDN、TLS 和基础防护；暂不迁移到 Cloudflare Pages。

- [x] 确定并购买正式域名 `ustsacm.fun`，将 DNS 托管到 Cloudflare。
- [x] 在 GitHub Pages 配置并验证自定义域名，Cloudflare DNS 通过 CNAME Flattening 指向 `greenthree.github.io`。
- [x] 配置 Cloudflare TLS、强制 HTTPS、合理的缓存规则和静态资源长期缓存；`index.html` 与 SPA `404.html` 不使用会阻碍发布生效的长期缓存。2026-07-28 已为 `/assets/*` 部署一年期 Edge/Browser TTL 与浏览器可见的 `public, max-age=31536000, immutable` 指令；`npm run check:cloudflare-domain` 确认裸域 HTTPS、`www`/旧 Pages 跳转、SPA 回退、HTML `max-age=600`、指纹资源 `max-age=31536000` + `immutable` 和二次 `CF-Cache-Status: HIT` 全部通过。证据见 [`docs/evidence/cloudflare-domain-verification-2026-07-22.md`](./docs/evidence/cloudflare-domain-verification-2026-07-22.md)。
- [x] 更新 Supabase Auth Site URL、允许的重定向地址、Edge Function CORS 和生产前端 Origin 白名单。
- [x] 验证首页、深链刷新、登录、真实邮箱找回密码、账号页、个人数据导出和后台入口在新域名下正常工作。2026-07-26 已使用真实管理员登录态复核 `/account` 与 `/admin`；2026-07-29 又完成受控 HTML 缓存清理、旧地址跳转、TLS/DNS 基线和完整个人数据文件下载复验。下载文件可解析为版本化 JSON，敏感键扫描为零且没有进入仓库或 CI Artifact。证据见 [`docs/evidence/cloudflare-domain-verification-2026-07-22.md`](./docs/evidence/cloudflare-domain-verification-2026-07-22.md) 与 [`docs/evidence/personal-data-export-production-2026-07-20.md`](./docs/evidence/personal-data-export-production-2026-07-20.md)。
- [ ] 确认 `greenthree.github.io/USTSACMLand/` 自动跳转到正式域名，并按运行手册验证 DNS、缓存清理、证书和回滚步骤。2026-07-29 已再次用真实 Chrome 验证旧地址跳转，完成四个 SPA 文档的受控 URL 清理，核对根域/`www` 已代理 CNAME、`Full (strict)` 与当前有效证书；实际切换 DNS only 或移除 GitHub Pages 自定义域名会改变生产流量路径，仍待明确维护窗口执行回滚演练。
- [ ] Cloudflare 接入稳定后更新 README、隐私说明、运维文档和所有公开链接。

## 5. 已暂停并归档的遗留模块

本节只保存历史实现与验收记录，不是待办清单，也不构成发布阻塞。WebChat、图片输入和推荐计划不再新增功能、不再进行中转站/视觉模型/邀请码/奖励/并发烟测，也不再安排生产重开。现有代码、Schema、函数、测试和证据保留，以避免破坏数据库历史及既有安全边界。

运行边界固定为：数据库 WebChat 请求开关关闭，`CHAT_ENABLED=false`，Pages 构建变量 `VITE_WEBCHAT_UI_ENABLED=false`、`VITE_WEBCHAT_IMAGE_INPUT_ENABLED=false`，推荐计划全局开关关闭。维护工作只允许验证入口不可见、服务端拒绝请求、遗留私有数据仍受 RLS/注销/备份约束，以及修复关闭状态下的安全问题。

### WebChat 与图片输入历史记录

- 历史完成：图片安全基础已以默认关闭方式部署到生产：71 项 migration 全部一致，`webchat-attachment` 与 `webchat-image-cleanup` 为 ACTIVE，私有 Bucket、4 MiB/仅 WebP 限制、全站暂停、匿名/普通成员拒绝和夹具零残留已通过 47 项可复跑生产检查；这不代表图片输入已向成员开放。证据见 [`docs/evidence/webchat-image-foundation-production-2026-07-25.md`](./docs/evidence/webchat-image-foundation-production-2026-07-25.md)。
- 历史完成：默认关闭状态下的真实图片对象生命周期已完成生产验收：随机临时成员的规范 WebP 经私有路径保存，本人历史可恢复、跨成员和直接 Storage 读取被拒绝、30 秒签名预览内容与 SHA-256 一致；删除消息后正式清理函数只领取该夹具，零重试/零死信删除对象并恢复全局账目，最终注销后附件、对象和删除队列物理零残留。可复跑生产检查现为 55 项且 `cleanupFallbacks=0`；前端和视觉模型仍未开放。证据见 [`docs/evidence/webchat-image-foundation-production-2026-07-25.md`](./docs/evidence/webchat-image-foundation-production-2026-07-25.md)。
- 历史完成：私有 Supabase Storage、成员/会话隔离、本人历史引用、跨成员拒绝、浏览器直读拒绝和 30 秒签名预览已用真实生产对象验收；浏览器不接触 service role key。开放态附件界面验收在项目停止时未执行，现已取消。
- 历史完成：图片对象的删除消息队列、幂等领取、零重试/零死信物理清理、注销零残留和全局 Storage 对账已通过真实生产生命周期验收；定时 schedule 仍保持关闭。
- 历史完成：图片 Schema v2 加密备份与隔离恢复路径已在当前生产零对象状态通过：安装状态、私有 Bucket、匿名拒绝、数据库引用、对象集合哈希、Auth/RLS 和恢复夹具清理均成功。项目停止前未执行非空对象贯通恢复；该开放态验收现已取消，零对象结果只作为关闭态恢复安全基线。证据见 [`docs/evidence/webchat-image-backup-restore-2026-07-25.md`](./docs/evidence/webchat-image-backup-restore-2026-07-25.md)。
- 已停止：支持在 WebChat 输入区直接粘贴剪贴板图片，也支持通过图片按钮选择本地文件；发送前展示稳定尺寸的缩略图、文件状态和移除操作，桌面端、移动端与键盘操作均可用。客户端实现与本地开启态验收已完成：Browser 实测选择、预览和移除无控制台错误，粘贴与图片发送/刷新恢复进入 Chromium 门禁，纯键盘添加/移除在 Chromium、Firefox、WebKit、390px 移动端和宽屏五项目通过；生产三层开关保持关闭，开放计划已经取消。证据见 [`docs/evidence/webchat-image-client-local-2026-07-26.md`](./docs/evidence/webchat-image-client-local-2026-07-26.md)。
- 已停止：第一版只接受 JPEG、PNG 和 WebP，拒绝 SVG、动图和伪造 MIME；客户端与服务端同时限制单图体积、像素尺寸、单条消息图片数量、会话待上传总量和账号级 Storage 使用；4 MiB、2,048 px / 4,194,304 像素、每条 4 张、每会话待处理 8 张 / 16 MiB、每账号 200 个 / 64 MiB、滚动一小时 30 个新附件等具体上限已写入 [`docs/webchat-image-input-v1.md`](./docs/webchat-image-input-v1.md)。数据库已在每账号行锁内按最近一小时 `reserved_at` 记录计数；从零安装全部 migration 后当前 48 个 pgTAP 文件、1206 项断言通过，真实双连接验证第 30 个预留成功、第 31 个在等待同一全局优先锁后以账号滚动限额拒绝。生产 migration 和默认暂停边界已部署验收；开放态端到端验收在项目停止时未执行，现已取消。证据见 [`docs/evidence/webchat-image-safety-foundation-2026-07-23.md`](./docs/evidence/webchat-image-safety-foundation-2026-07-23.md) 与 [`docs/evidence/webchat-image-foundation-production-2026-07-25.md`](./docs/evidence/webchat-image-foundation-production-2026-07-25.md)。
- 已停止：图片消息使用中转站兼容的多模态消息格式发送，并在请求前确认当前模型支持视觉输入；不支持图片的模型必须给出明确提示，不能静默丢图、降级为 OCR 文本或自动改用其他模型。服务端本地实现与门禁已完成：当前运行模型必须与审核模型完全一致，图片以 Responses `input_image` / `detail: high` 发送，工具固定关闭；真实视觉模型生产烟测在项目停止时未执行，现已取消。证据见 [`docs/evidence/webchat-image-relay-quota-local-2026-07-26.md`](./docs/evidence/webchat-image-relay-quota-local-2026-07-26.md)。
- 已停止：图片输入沿用 WebChat 的单次请求 claim、累计请求上限和累计 Token 上限；服务端按可解释的保守值预留图片 Token，成功后以中转站真实 usage 结算，上游启动前失败释放预留，上游启动后无法取得 usage 时把预留转入未知用量，付费请求仍禁止自动重试。本地已完成最坏尺寸图片预留、真实 usage 解析、未知用量结算和单次 fetch 门禁；本轮进一步保证图片请求体校验发生在上游围栏前、超时从围栏后计时，且围栏确认后不再尝试释放 claim。四个核心专项文件 67 项、完整 WebChat Edge Function 目录 79 项均为 0 失败；真实中转站图片 usage 生产烟测在项目停止时未执行，现已取消。证据见 [`docs/evidence/webchat-image-relay-quota-local-2026-07-26.md`](./docs/evidence/webchat-image-relay-quota-local-2026-07-26.md)。
- 已停止：在开放态附件流程中完成上传、签名预览、发送和刷新恢复；删除会话时清理全部对象，个人数据导出只包含本人附件清单与必要元数据，不泄露长期可访问 URL。2026-07-26 已在默认关闭的生产安全烟测中使用随机临时成员和真实私有 WebP 验证：本人导出仅含媒体类型、字节、尺寸和生命周期时间，另一成员附件计数为 0，且导出不含签名 URL、对象路径、哈希、附件/会话/消息标识；消息删除、对象清理、附件/队列物理清理和账号注销后零残留均通过。向成员开放后的客户端发送与刷新恢复流程在项目停止时未执行，现已取消。证据见 [`docs/evidence/webchat-image-foundation-production-2026-07-25.md`](./docs/evidence/webchat-image-foundation-production-2026-07-25.md)。
- 已停止：在开放态附件流程中复核服务端文件签名、解码、像素上限和 EXIF 移除；确认图片内容、签名 URL 和原始文件名不进入日志、审计或错误消息，并验收上传失败、过期对象和孤儿对象的清理路径。本地生产实现已完成 fail-closed 签名 URL 校验、显式静态 WASM 部署打包和本地预览 origin 安全重写；真实 JPEG/PNG/WebP 规范化、JPEG EXIF 方向与元数据清理、伪造格式拒绝、日志脱敏、上传回滚和删除队列共 129 项专项测试通过。真实 Supabase Edge Runtime PNG→WebP、签名预览、历史恢复、零重试删除、Storage 对账及测试账号零残留烟测也已通过。生产开放态异常路径验收在项目停止时未执行，现已取消。证据见 [`docs/evidence/webchat-image-attachment-security-local-2026-07-26.md`](./docs/evidence/webchat-image-attachment-security-local-2026-07-26.md)。
- 已停止：图片功能全线开启前增加全站每小时上传数量/字节预算、总 Storage 容量上限和并发熔断，并完成匿名注册滥用防护；账号级限额不能作为批量注册攻击下的唯一成本边界。全站预算、Storage 预留、跨实例 validation lease、删除确认释放和漂移自动暂停已实现。2026-07-28 已创建 Managed Turnstile Widget，配置 Supabase 私有 Secret、真实邮箱确认与 Auth 限流，写入 Pages 公开变量并部署；无 token 与伪 token 的生产直连注册均以 HTTP 400 / `captcha_failed` 拒绝，preflight 与严格就绪检查通过。图片开放相关的剩余风控验收随项目停止而取消；通用注册限流 `429` 恢复仍作为独立发布门禁保留，推荐计划和 WebChat 图片开关继续关闭。证据见 [`docs/evidence/registration-abuse-foundation-2026-07-23.md`](./docs/evidence/registration-abuse-foundation-2026-07-23.md)、[`docs/evidence/supabase-ten-function-readiness-2026-07-26.md`](./docs/evidence/supabase-ten-function-readiness-2026-07-26.md) 与 [`docs/evidence/registration-abuse-production-gap-2026-07-28.md`](./docs/evidence/registration-abuse-production-gap-2026-07-28.md)。
- 已停止：补齐开放态粘贴、选择、预览、移除、发送、刷新恢复、模型不兼容、超限、上游前失败释放、上游后未知用量保守结算、移动端和无障碍自动化；完成真实视觉模型烟测及受控非空对象备份恢复贯通演练。2026-07-26 本地完整 WebChat 矩阵为 95 项：75 通过、20 项按项目能力设计跳过；已覆盖图片选择、粘贴、私有 URN、刷新预览、四张上限、键盘操作、390px 无溢出和 axe。图片附件、清理、协议、额度与监控专项现为 129 项通过；全量 Edge Function 为 462 项通过、0 失败、1 项按环境忽略，并覆盖真实编解码、真实 Edge Runtime 上传/预览/清理、围栏前校验、真实 usage 结算、单次 fetch、围栏后超时和启动后禁止释放。项目停止时未完成的生产开放态、真实视觉模型、用量结算故障和非空备份恢复验收均已取消，不再作为后续任务。

## 6. v1.0.0 发布后用户功能

### 训练目标

- [x] 明确第一版训练目标范围：目标周期、目标指标、是否支持总题数/平台题数/Rating，以及默认隐私边界。契约见 `docs/training-goals-v1.md`。
- [x] 设计并部署训练目标数据库表、RLS、历史保留和注销级联；普通成员只能读写自己的目标。
- [x] 使用成功同步快照计算目标进度，失败同步不能推进或倒退目标，题数回退需要明确标记。
- [x] 在成员端提供创建、编辑、完成和归档目标的交互页面，并处理空状态、过期目标和无平台绑定状态。
- [x] 管理员默认不得修改成员目标；如将来需要队内指导权限，必须单独设计授权和审计，不在第一版默认开放。
- [x] 使用真实生产成员完成训练目标创建、编辑、刷新恢复、归档和个人数据导出生成烟测；临时目标归档后进行中数量恢复为 0，历史数量由 1 增至 2，没有留下进行中夹具。证据见 `docs/evidence/training-goals-verification-2026-07-22.md`。
- [x] 实现并在本地空库验证 `202607310001_training_goal_quota_concurrency.sql`：成员级事务 advisory lock 串行化“计数 → 插入”临界区；真实双连接从 19 个进行中目标并发创建时，第二个请求等待锁后收到原有额度错误，最终保持 20 个目标且夹具零残留。该检查已纳入 CI 必跑门禁，证据见 [`docs/evidence/training-goal-concurrency-local-2026-07-31.md`](./docs/evidence/training-goal-concurrency-local-2026-07-31.md)。
- [x] 将 `202607310001_training_goal_quota_concurrency.sql` 部署到生产；部署前 `migration list --linked` 仅显示该项缺失，`db push --dry-run` 仅计划该 migration，部署后本地与远端版本完全一致。证据见 [`docs/evidence/training-goal-concurrency-production-2026-07-31.md`](./docs/evidence/training-goal-concurrency-production-2026-07-31.md)。
- [x] 在不篡改生产成员数据的前提下完成普通成员创建训练目标流程烟测：2026-08-01 使用普通测试成员的真实成功同步基线完成创建、编辑、刷新恢复、归档和历史记录核对，进行中数量恢复为 0，未修改成员资料、平台绑定或统计数据。证据见 [`docs/evidence/training-goals-ordinary-member-production-2026-08-01.md`](./docs/evidence/training-goals-ordinary-member-production-2026-08-01.md)。
- [ ] 使用成功同步快照使真实目标达到阈值并完成“确认完成”流程。2026-07-26 已在本地 Supabase 重新执行 `supabase/tests/38_training_goals.test.sql`，30 项 pgTAP 全部通过，覆盖成功同步快照达标、显式完成、重复完成拒绝、RLS、乐观锁、归档、导出和注销级联；生产只读核对显示当前账号 0 个进行中目标、2 个均为 0% 的已归档目标，因此仍缺自然训练进度达标后的生产 UI“确认完成”证据，未通过篡改生产统计制造达标。证据见 `docs/evidence/training-goals-verification-2026-07-22.md`。

## 7. 推荐计划历史记录

以下记录仅用于解释已保留的数据库和前端实现，不再作为待办、发布门禁或下一步工作。生产全局开关与重开安全闸门保持关闭；已有邀请码、绑定和奖励数据不删除，也不继续发放。

- 已停止：在管理后台提供推荐计划全局开关，管理员可一键开启或关闭，并清晰显示当前状态、最后修改时间和修改人；关闭和重新开启都需要二次确认，操作结果即时反馈。2026-07-26 已在正式后台只读确认关闭状态、配置版本、最后修改时间、修改人和原因，并打开开启方向的二次确认：变更原因与全站影响确认未完成前，确认按钮保持禁用；随后取消且未修改生产配置。关闭态页面、焦点和失败关闭边界仅作为历史证据保留，不再安排重开。证据见 [`docs/evidence/production-referral-global-switch-2026-07-23.md`](./docs/evidence/production-referral-global-switch-2026-07-23.md)。
- 已停止：全局开关必须由私有数据库配置和仅管理员可调用的 RPC 强制执行，并包含原因、乐观锁、原子限流和审计记录；注册触发器、邀请码校验、账号页摘要和奖励事务都读取同一状态，不能只隐藏前端入口。生产关闭/重开烟测和重开安全闸门均已完成；2026-07-26 的历史快照为 71 个 production migration，当前生产基线已更新为 75 个 migration。仓库当前 48 个 pgTAP 文件、1206 项断言已在干净数据库通过。证据见 [`docs/evidence/referral-concurrency-local-2026-07-26.md`](./docs/evidence/referral-concurrency-local-2026-07-26.md)。
- 已停止：关闭后立即停止邀请码展示、公开校验、新绑定和新奖励，但不删除已有邀请码、绑定或撤回已发 Token；新用户仍可正常注册。关闭态、初始检查和状态查询失败时，注册页与成员账号页均不渲染推荐计划名称、邀请码或历史奖励摘要；重新开启后沿用原邀请码，不追补关闭期间完成的注册，也不改变已有奖励次数。成员端单元测试与本地桌面/移动浏览器烟测已通过；原计划的生产页面验收已随项目停止而取消。
- 已停止：开关切换与并发注册使用数据库行锁或等价事务围栏：关闭事务提交后启动的注册不得绑定或计奖，已成功提交的绑定不能被回滚；重复点击和网络响应丢失必须可安全对账。数据库已统一 `profile -> config -> code -> access` 锁序并收紧同管理员/同原因的丢失响应识别；本地真实双连接已分别验证“确认先提交、关停后提交”“关停先提交、确认后提交”和丢失响应重放，并已纳入 GitHub `database-security` 必跑门禁。原计划的受控生产双连接烟测已随项目停止而取消。证据见 [`docs/evidence/referral-concurrency-local-2026-07-26.md`](./docs/evidence/referral-concurrency-local-2026-07-26.md)。
- 已停止：补齐普通成员越权、停用管理员、最后管理员保护、并发开关/注册、审计脱敏、关闭状态页面、重新开启和生产回滚烟测后再上线；本地权限矩阵、审计白名单、关闭/重开和前端失败状态已覆盖。
- 已停止：为每名已注册成员生成可分享的邀请码，并在账号页提供查看和复制入口；生产 migration 与真实邀请码读取已通过。前端发布和正式页面烟测未执行，并已随项目停止而取消。邀请码不得暴露成员邮箱、QQ、数据库主键或其他私有标识。
- 已停止：注册页增加可选邀请码字段；真实生产注册与邀请码绑定已通过。页面输入、分享链接预填和无邀请码注册的发布后验证未执行，并已随项目停止而取消。新用户可不填写邀请码正常注册，填写时必须验证邀请码存在且可用，并在注册成功后绑定到邀请码所属成员。
- 已停止：每个新成员最多绑定一个邀请人，绑定成功后不可由普通用户改绑；唯一约束与行锁已实现，原计划的生产并发验收已取消。
- 已停止：每次有效绑定为邀请人增加 `1,000,000` WebChat 累计 Token 额度上限，不修改其已使用 Token，也不绕过全站预算和其他服务端限额；旧流程的生产计奖烟测已完成，本地第 10 次奖励并发竞态确认额度只增加一次。邮箱确认后计奖的新流程未进行真实生产注册复测，并已随项目停止而取消。
- 已停止：只有邀请人的邮箱首次确认后才建立绑定并发放奖励；未验证邮箱不得占用十次名额或增加 Token 上限，重复确认必须幂等，确认时邀请码失效不得阻断账号确认。安全 migration 已部署并撤销仍未验证账号的历史奖励，本地 18 项专项断言通过。真实邮件确认烟测和批量注册防护验收未执行，并已随项目停止而取消。
- 已停止：推荐计划当前已在生产全局暂停并保留已有邀请码、绑定和奖励。`202607230003_referral_reopen_safety_gate.sql` 已单独部署并通过迁移内真实拒绝自检，默认锁死未经受控运维解锁的重新开启；证据见 [`docs/evidence/production-referral-reopen-safety-gate-2026-07-23.md`](./docs/evidence/production-referral-reopen-safety-gate-2026-07-23.md)。项目已取消重开计划，不再补做邮箱计奖、注册风控或并发奖励验收。
- 已停止：每名邀请人最多接受 10 次有效邀请绑定，即累计最多增加 `10,000,000` WebChat Token 额度上限；达到上限后邀请码不可再用于新用户注册绑定，也不得继续发放额度。本地从第 9 次开始的两个邮箱确认真实并发只产生第 10 次绑定、一次奖励和一次审计；原计划的受控生产上限烟测已取消。
- 已停止：邀请绑定、奖励次数和额度变更必须在同一数据库事务内完成，使用唯一约束和幂等键防止重复计奖，并写入管理员可查询的审计记录。本地双连接关停围栏、第 10 次并发和响应丢失重放均保持精确账目；原计划的生产复验已取消。
- 已停止：已明确停用、注销和重新注册时的奖励规则，并补齐滥用防护、RLS、并发、额度边界、注册回滚和个人导出测试；自动化测试、生产部署、真实绑定、被邀请人注销后奖励保留以及邀请人注销清理已通过，本地双连接与第 10 次上限已补齐。原计划的受控生产并发与十次上限验收已取消。

## 8. 完成定义

任一任务只有同时满足以下条件才可标记完成：

- 行为符合验收标准，正常、空数据、失败和无权限状态均有处理。
- 关键逻辑有自动化测试；数据源解析和重试策略有固定样本及故障测试。
- 不引入明文秘密、越权查询、无限重试或未审计的管理员写操作。
- 文档、数据库 migration、生成类型和生产配置与实现保持一致。
- 在 GitHub Pages 生产构建和真实生产边界中验证，而不只在本地开发服务器运行。
- 已完成的任务必须从 `[ ]` 改为 `[x]`；仅完成代码但缺生产配置或验收时继续保持 `[ ]`。

## 9. 主要风险

| 风险                            | 影响                                         | 应对                                                                       |
| ------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| 第三方平台限流、结构变化或封禁  | 同步延迟或失败                               | 每次最多一次可恢复错误重试、固定样本契约测试、后台健康状态、保留最后成功值 |
| QOJ / Firecrawl 登录或额度异常  | 周更数据不可用或产生额外成本                 | Vault 多 Key、额度检查、一次重试上限、会话清理和生产演练                   |
| 重试与队列重复领取              | 重复上游请求或旧结果覆盖新结果               | 原子领取、attempt fencing、幂等快照和明确最终状态                          |
| 账号删除跨系统失败              | Auth、业务数据或恢复下限不一致               | 目标绑定恢复租约、事务 fence、失败关闭和生产对账                           |
| 遗留 WebChat 或推荐计划被误开启 | 暴露已退出产品范围的入口、外部请求或奖励流程 | 保持前端、函数和数据库开关关闭；发布与巡检只验证关闭边界，不执行重开       |
| 遗留私有会话或图片数据越权      | 历史私有数据泄露                             | 保留 RLS、私有 Bucket、注销级联、备份边界和安全回归测试                    |
| Cloudflare 缓存配置错误         | 新版本不生效、SPA 深链或登录回调异常         | HTML 短缓存、静态资源指纹缓存、回调白名单验证和 GitHub Pages 回滚入口      |
