# 正式发布检查单

本检查单用于 USTS ACM Land 的候选版本、正式版本和紧急修复发布。每次发布复制一份到变更记录中填写，不在仓库中记录密码、Token、Cookie、成员私有资料或第三方原始响应。

## 1. 发布范围与责任人

- [ ] 已记录版本号、候选提交、变更摘要、发布人和复核人。
- [ ] 工作树只包含本次发布内容；临时截图、导出文件和根目录本地素材未被误纳入。
- [ ] 数据库、Edge Functions、前端和配置的兼容顺序已明确。
- [ ] 已记录最后一个可用的 Git 提交、Pages 部署和 Supabase migration 状态。

## 2. 本地与 CI 门禁

- [ ] Node.js 版本符合 `.nvmrc`，使用 `npm ci` 安装锁定依赖。
- [ ] 以下命令全部通过：

  ```powershell
  npm run format:check
  npm run lint
  npm run check:ci-workflow
  npm run check:sync-workflow
  npm run check:backup-workflow
  npm run check:webchat-relay-workflow
  npm run check:repository-readiness -- greenthree/USTSACMLand
  npm run check:supabase-preflight
  npm test
  npx playwright install chromium firefox webkit
  npm run test:e2e
  npm run build
  npm run check:bundle
  npx --yes deno check --config supabase/functions/deno.json supabase/functions/sync-member/index.ts supabase/functions/sync-stats/index.ts supabase/functions/delete-account/index.ts supabase/functions/change-password/index.ts supabase/functions/webchat/index.ts supabase/functions/webchat-config/index.ts
  npx --yes deno lint --config supabase/functions/deno.json supabase/functions
  npx --yes deno test --allow-read --allow-env --config supabase/functions/deno.json supabase/functions
  git diff --check
  ```

- [ ] GitHub `CI / verify`、`CI / database-security`、`Secret scan / gitleaks` 和部署后的 `production-ranking-audit` 全部通过。
- [ ] Dependabot 没有尚未评估的高危更新；依赖升级已由测试和构建验证。
- [ ] 构建日志、测试输出和 Actions artifact 不含 Secret 或成员私有资料。
- [ ] `Encrypted database backup` 最近一次手动任务成功，Artifact 只包含 `.enc` 和 `.enc.sha256`。

## 3. 数据库与权限

- [ ] 所有新 migration 已在空库 CI 中按时间顺序应用并通过 pgTAP。
- [ ] `supabase migration list --linked` 与预期一致，`db push --dry-run` 只包含本次 migration。
- [ ] 未登录、普通成员、停用成员、管理员和 service role 的权限边界均已复核。
- [ ] 生产 Auth 已启用 Secure password change；普通账号页改密只经过 `change-password`，成功后服务端全局撤销刷新会话、本设备退出，撤销未确认时显示部分成功警告；恢复页仅在 `PASSWORD_RECOVERY` 邮件会话中调用 Auth `updateUser(password)` 并随后全局登出。
- [ ] 公开视图不返回邮箱、QQ、内部错误、审计详情或 Secret。
- [ ] 管理员 RPC 保留鉴权、乐观锁、审计和速率限制；清单与数据库目录中的全部 `admin_*` 函数一致，普通/停用成员无法调用 19 个入口，8 个 `_unlimited` 实现不可由浏览器角色执行。
- [ ] 注销流程的目标绑定租约覆盖“取得 owner/target 租约 → 记录并确认 GitHub 恢复下限 → 续期并停止外部阶段心跳 → 最终 RPC 锁定租约/Profile → 同事务删除 Auth 用户与消费租约”完整临界区；业务级联与审计匿名化整体提交或回滚，管理员注销仍要求先交接权限。
- [ ] 管理员提升/降级要求原因、乐观锁、速率限制和二次确认；并发操作也不能移除最后一名启用管理员。
- [ ] 活动同步和当前管理员角色均在数据库最终删除点阻止注销；前管理员降级注销后，公告创建者、审批者及全部审计 JSON 中均无其 UUID。

## 4. Edge Functions 与同步

- [ ] 按“数据库 → Edge Functions → Pages”的顺序部署。
- [ ] `sync-member`、`sync-stats`、`delete-account`、`change-password` 使用仓库 import map 部署成功。
- [ ] 如本次发布 WebChat：`webchat-config` 与 `webchat` 使用仓库 import map 部署成功，`CHAT_ENABLED` 在受控启用前仍为 `false`。
- [ ] 数据库与函数部署后，严格运行 `npm run check:supabase-readiness`，不再允许待部署 migration、缺失函数或 `404` 边界。
- [ ] 发布记录包含当前 Git SHA 与六个 Edge Function 部署后版本号；黑盒就绪检查不作为源码一致性证明。
- [ ] `npm run check:supabase-readiness` 确认六个函数均精确允许正式 Pages Origin、不允许恶意 Origin，且匿名 GET 只返回 `401` 或 `405`。
- [ ] `npm run check:supabase-readiness` 确认数据库队列 Vault 配置完整、五分钟 cron active、最近 12 分钟有调度、最近 HTTP 为 2xx 且近 15 分钟至少一次 cron 成功。
- [ ] 仅对受控测试成员执行一次单平台同步，快照、运行记录、新鲜度和审计一致。
- [ ] Codeforces、牛客、AtCoder、XCPC ELO、洛谷、QOJ 的固定样本契约测试通过。
- [ ] QOJ 健康检查最多执行一次且不自动重试；临时 Firecrawl 会话最终关闭。
- [ ] 同步失败 Webhook 只发送脱敏任务信息，投递失败不会改变主任务结果。
- [ ] 已确认日更、周更和到期队列 cron 使用 UTC 表达正确的北京时间计划。

## 5. 凭据与外部服务

- [ ] 浏览器构建只含 `VITE_SUPABASE_URL` 和公开 anon key，不含 service role 或第三方凭据。
- [ ] 洛谷 Cookie/CSRF、QOJ 服务账号、Firecrawl key 和告警 Token 均来自可独立轮换的生产 Secret。
- [ ] `SYNC_QUEUE_TOKEN` 使用独立随机值，Edge Secret 与 Vault 一致；Vault 和 cron catalog 均不含 service role key。
- [ ] 注销恢复 Token 只授权目标仓库 Variables write；`DELETION_RECOVERY_REPOSITORY` 指向正式仓库。
- [ ] `ALLOWED_ORIGIN` 只包含实际 Origin，不包含路径或通配敏感域。
- [ ] 生产凭据轮换人、存放位置和回滚方式已记录；未把真实值复制到发布记录。
- [ ] Firecrawl 用量、QOJ 登录、洛谷认证和 Supabase 配额均处于可用状态。
- [ ] 使用与生产 `FIRECRAWL_API_KEY` 相同团队的维护者凭据运行 `firecrawl credit-usage --json --pretty`；剩余比例高于 25%，或已记录扩容/降耗措施。不得把 API Key 或完整凭据配置写入发布记录。
- [ ] 如本次启用或更换 WebChat 中转站：手动 `WebChat relay compatibility` 工作流已通过非流式、Responses typed SSE、Usage 和 Abort 四项；下载的 14 天 Artifact 不含 Prompt、回复、请求 ID、Key 或明文主机，`CHAT_ENABLED` 在完成函数边界和额度复核前仍为 `false`。
- [x] `npm run test:e2e:webchat` 已通过五浏览器矩阵；10 个独立页面回复不串流、10 路同时 HTTP 流全部完成、键盘停止触发 Abort、减少动画和移动端 axe 门禁均无回归。PR #57 与合并后的 main CI 均已实际通过。
- [ ] `/admin/webchat` 已由当前有效管理员写入同一组 Base URL、模型与 Key，并设置全站北京时间每日请求/Token 预算；Key 仅存在 Supabase Vault，配置读取和审计只显示脱敏状态，首次配置、留空保留、轮换、预算更新、数据库暂停和版本冲突均已烟测。
- [ ] `/admin/webchat` 当日请求数、已结算/预留 Token、剩余额度与北京时间重置时间和数据库聚合账本一致；请求/Token 首次阻断各只投递一次脱敏 `webchat_budget_exhausted`，投递失败不改变 `503` 且不重试。
- [ ] 在账号详情中只为本次 3–5 名试运行账号开启 AI 助手并逐人设置每日请求/Token 上限；无授权行、关闭授权、停用账号或角色不是成员/管理员均返回结构化 `403`，撤权或降额在数据库原子 claim 前立即生效。
- [x] 已授权账号 `/assistant` 显示的当前模型、北京时间当日请求、已结算/预留 Token、剩余额度与服务端配置及私有账本一致；该模型进入同次请求的服务端系统提示词与额度指纹，账号无法读取他人额度、全站预算、中转站地址或 Key。2026-07-17/18 的 localhost 与 Pages 生产验证均通过。
- [x] WebChat 启用顺序为 `CHAT_ENABLED=true` → 后台打开数据库请求开关 → GitHub 仓库变量 `VITE_WEBCHAT_UI_ENABLED=true` → 触发下一次 Pages 构建；Pages run `29594758865` attempt 2 已通过配置校验、构建、部署与生产榜单审计。关闭时先关闭数据库请求开关，必要时同时恢复另外两层为 `false`。

## 6. 前端与可访问性烟测

- [ ] 正式首页、榜单、成员详情、隐私页、注册、登录、账号页和后台可直达并刷新。
- [ ] 访客、普通成员、停用成员和管理员看到的导航与路由符合权限。
- [ ] 部署后的只读生产门禁拒绝演示回退，并用公开视图逐页复算全部成员在总榜与各平台榜的排序、总 Rating、总历史最高 Rating 和总题数。
- [ ] 桌面、390px 移动端和至少一个宽屏视口无页面级横向溢出。
- [ ] 键盘可完成主要导航、筛选、平台标签、分页和高风险确认；焦点可见且顺序合理。
- [ ] 浏览器控制台没有与本次变更相关的 error/warn，分享元数据与方形图标可访问。

## 7. 法务、隐私与发布决定

- [ ] `PRIVACY.md`、站内隐私页、第三方数据来源和实际数据生命周期一致。
- [ ] 如本次启用 WebChat：站内隐私页已说明消息转发对象、本站不保存对话正文及私有额度账本边界；负责人已核对并记录真实中转站和上游模型的留存、训练、删除与跨境政策，未确认前保持生产三层开关关闭。
- [ ] 已在运维手册核验并填写 Supabase、GitHub Actions 和 Firecrawl 的实际保留窗口、负责人及删除/恢复限制。
- [ ] 受控注销已验证三类结果：租约冲突/删除前续期失败或 GitHub 写入/确认失败返回 `503` 且 Auth 用户未删除；错误 owner/target、过期租约、管理员、活动同步或 Storage 所有权阻塞返回 `409` 或失败关闭且账号数据完整；成功时 Auth/Profile 级联、审计匿名化和租约消费在同一事务提交。
- [ ] 使用两个数据库连接验证最终 RPC 的行锁 fencing：竞争接管在删除事务结束前持续阻塞；记录完整提交耗时、响应丢失后的状态对账，以及旧 access JWT 无法越过 live Profile/RLS 边界。
- [ ] 恢复工具拒绝早于当前注销恢复下限的备份，并拒绝仓库变量回退到备份 metadata 之前。
- [ ] 已按 [数据库备份与恢复方案](./backup-and-recovery.md) 在隔离 Supabase 项目完成解密、校验、恢复、登录和行数核对。
- [ ] 已确认学校、集训队、ICPC 等名称和图形标识的使用授权范围。
- [ ] 已由项目负责人选择并加入 `LICENSE`；在此之前不得把源码描述为开源。
- [ ] 真实队员已小范围核对姓名、专业、年级、平台绑定和统计值。
- [ ] 已观察至少一个完整日更批次；涉及 XCPC ELO/QOJ 时观察到下一个周二批次。
- [ ] 所有阻塞问题已关闭，遗留非阻塞风险有负责人和后续日期。

## 8. 发布与观察

- [ ] 复核人明确给出发布决定后，才创建带注释的 `v1.0.0`（或对应版本）标签。
- [ ] 标签指向已通过全部门禁并实际部署的提交，不在失败构建上移动或复用标签。
- [ ] Pages、认证、后台、同步队列、告警和数据库指标在发布后观察窗口内正常。
- [ ] 若出现故障，已按 [生产运维手册](./operations-runbook.md) 执行 Git revert、函数兼容回滚或数据库前向修复。
- [ ] 发布记录包含验证证据、最终部署 ID、遗留风险和下一位维护者。
