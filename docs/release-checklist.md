# 正式发布检查单

> 产品范围说明：WebChat / AI 学习助手与推荐计划已停止开发并退出发布范围。其既有代码、migration、函数、测试和数据结构保留；下文相关历史记录不再阻塞 `v1.0.0`。发布时只需确认成员入口不可见、请求/图片/奖励流程关闭、服务端失败关闭，且遗留私有数据的 RLS、注销与备份边界没有回归。

本检查单用于 USTS ACM Land 的候选版本、正式版本和紧急修复发布。每次发布复制一份到变更记录中填写，不在仓库中记录密码、Token、Cookie、成员私有资料或第三方原始响应。

发布全过程由维护 Agent 按根目录 `agent.md` 执行并监控到终态。项目负责人只提供必要凭据输入以及发布决定或高风险批准，不负责运行命令、操作普通控制台步骤或等待 CI。

## 1. 发布范围与责任人

- [ ] 已记录版本号、候选提交、变更摘要、项目负责人批准和执行 Agent/会话。
- [ ] 工作树只包含本次发布内容；临时截图、导出文件和根目录本地素材未被误纳入。
- [ ] 数据库、Edge Functions、前端和配置的兼容顺序已明确。
- [ ] 已记录最后一个可用的 Git 提交、Pages 部署和 Supabase migration 状态。
- [ ] 项目负责人已按 `docs/maintainer-handoff.md` 确认所需供应商权限与高风险操作范围；Agent 只使用当前授权会话，记录不包含账号标识或 Secret。

## 2. 本地与 CI 门禁

- [ ] Node.js 版本符合 `.nvmrc`，使用 `npm ci` 安装锁定依赖。
- [ ] 以下命令全部通过：

  ```powershell
  npm run format:check
  npm run lint
  npm run check:ci-workflow
  npm run check:sync-workflow
  npm run check:backup-workflow
  npm run check:cloudflare-domain
  npm run check:restore-drill-workflow
  npm run check:webchat-relay-workflow
  npm run check:webchat-cache-probe-workflow
  npm run check:repository-readiness -- greenthree/USTSACMLand
  npm run check:supabase-preflight
  npm run check:referral-concurrency
  npm test
  npx playwright install chromium firefox webkit
  npm run test:e2e
  npm run build
  npm run check:bundle
  npx --yes deno check --config supabase/functions/deno.json supabase/functions/sync-member/index.ts supabase/functions/sync-stats/index.ts supabase/functions/sync-avatar/index.ts supabase/functions/member-avatar/index.ts supabase/functions/delete-account/index.ts supabase/functions/change-password/index.ts supabase/functions/firecrawl-config/index.ts supabase/functions/webchat/index.ts supabase/functions/webchat-attachment/index.ts supabase/functions/webchat-image-cleanup/index.ts supabase/functions/webchat-config/index.ts supabase/functions/webchat-cache-probe/index.ts
  npx --yes deno lint --config supabase/functions/deno.json supabase/functions
  npx --yes deno test --allow-read --allow-env --config supabase/functions/deno.json supabase/functions
  git diff --check
  ```

- [ ] GitHub `CI / verify`、`CI / database-security`、`Secret scan / gitleaks` 和部署后的 `production-ranking-audit` 全部通过。
- [ ] Dependabot 没有尚未评估的高危更新；依赖升级已由测试和构建验证。
- [ ] 构建日志、测试输出和 Actions artifact 不含 Secret 或成员私有资料。
- [x] `Encrypted database backup` 最近一次手动任务成功；`MAX_BACKUP_ARTIFACT_BYTES=3500000000` 与 `MAX_STORAGE_OBJECTS=10000` 已按 50 名成员的账号级理论上限配置。运行 `30192826527` 成功，Artifact 下载核对只包含 `.enc` 和 `.enc.sha256`；工作流在上传前完成 Schema v2 清单、8 个聚合行数、完整引用图片对象、解密校验和明文清理，Storage 失败时不会发布 database-only 的部分产物。证据见 [`docs/evidence/database-backup-capacity-guard-2026-07-26.md`](./evidence/database-backup-capacity-guard-2026-07-26.md)。
- [ ] 已按最近一次密文大小估算约 `14 × 单次加密快照大小` 的 Artifact 占用，并检查精确对象计划、逐对象下载耗时、Runner 磁盘和删除死信增长风险。

## 3. 数据库与权限

- [x] 所有新 migration 已在本地空库中按时间顺序应用并通过 pgTAP；`202607310001_training_goal_quota_concurrency.sql`、48 个测试文件、1206 项断言及真实双连接上限检查均已通过，且 CI 已强制执行同一检查。证据见 [`docs/evidence/training-goal-concurrency-local-2026-07-31.md`](./evidence/training-goal-concurrency-local-2026-07-31.md)。
- 历史记录：推荐计划 migration 曾验证邀请码唯一、注册绑定原子计奖、十次上限、自邀/重复/并发拒绝、注销匿名化和私有表无浏览器直读权限；模块现已关闭。
- 遗留关闭检查：推荐计划全局开关与重开安全闸门保持关闭；不再进行真实计奖、重开或生产并发烟测。关闭期注册必须继续降级为普通注册，不展示或校验邀请码，也不发放奖励。
- [ ] 按 `docs/registration-abuse-controls.md` 完成 Turnstile Site Key / Auth Secret、真实邮箱确认和 Auth 限流配置；无 token、伪 token、过期 token、有效注册、邮件确认和 `429` 恢复烟测均有脱敏证据。2026-08-04 的三次受控检查在临时降阈值并等待 30 秒后仍返回 `400 / invalid_credentials`，未触发 `429`；配置已恢复，门禁保持未完成。证据见 [`docs/evidence/auth-rate-limit-recovery-production-2026-08-04.md`](./evidence/auth-rate-limit-recovery-production-2026-08-04.md)。
- 历史记录：WebChat 图片 migration 与附件/清理 Edge Function 曾以默认关闭方式部署并完成私有 Bucket、权限和对象生命周期烟测；这些安全实现继续保留，但不视为功能上线或后续待办。
- 遗留关闭检查：`CHAT_VISION_ENABLED`、图片上传入口和清理调度保持关闭；不再配置或验收视觉模型。历史签名 URL、日志脱敏和对象归属安全测试继续保留。
- [x] `supabase migration list --linked` 与预期一致，`db push --dry-run` 只包含 `202607310001_training_goal_quota_concurrency.sql`；正式应用后再次核对本地与远端版本完全一致。证据见 [`docs/evidence/training-goal-concurrency-production-2026-07-31.md`](./evidence/training-goal-concurrency-production-2026-07-31.md)。
- [x] 未登录、普通成员、停用成员、管理员和 service role 的权限边界均已复核；生产 `npm run check:production-security` 通过 55 项真实身份、即时交接、跨成员隐私、图片默认关闭与真实对象生命周期、旧 JWT 和零残留检查，证据见 `docs/evidence/production-security-final-audit-2026-07-25.md` 与 `docs/evidence/webchat-image-foundation-production-2026-07-25.md`。
- [ ] 生产 Auth 已启用 Secure password change；普通账号页改密只经过 `change-password`，成功后服务端全局撤销刷新会话、本设备退出，撤销未确认时显示部分成功警告；恢复页仅在 `PASSWORD_RECOVERY` 邮件会话中调用 Auth `updateUser(password)` 并随后全局登出。
- [x] 公开成员视图只返回姓名、年级、专业和时间字段，停用成员不进入投影；匿名请求不能读取 Profile、审计、管理员或运行时密钥接口，证据见 `docs/evidence/production-security-final-audit-2026-07-25.md`。
- 遗留安全检查：私有 `webchat-images` Bucket 继续拒绝匿名读取，数据库引用、对象归属、注销清理和备份恢复边界不得回归。
- [ ] 管理员 RPC 保留鉴权、乐观锁、审计和速率限制；清单与数据库目录中的全部 `admin_*` 函数一致，普通/停用成员无法调用 19 个入口，8 个 `_unlimited` 实现不可由浏览器角色执行。
- [ ] 注销流程的目标绑定租约覆盖“取得 owner/target 租约 → 记录并确认 GitHub 恢复下限 → 续期并停止外部阶段心跳 → 最终 RPC 锁定租约/Profile → 同事务删除 Auth 用户与消费租约”完整临界区；业务级联与审计匿名化整体提交或回滚，管理员注销仍要求先交接权限。
- [ ] 管理员提升/降级要求原因、乐观锁、速率限制和二次确认；并发操作也不能移除最后一名启用管理员。
- [ ] 活动同步和当前管理员角色均在数据库最终删除点阻止注销；前管理员降级注销后，公告创建者、审批者及全部审计 JSON 中均无其 UUID。

## 4. Edge Functions 与同步

- [ ] 按“数据库 → Edge Functions → Pages”的顺序部署。
- [ ] `sync-member`、`sync-stats`、`sync-avatar`、`member-avatar`、`delete-account`、`change-password` 与 `firecrawl-config` 使用仓库 import map 部署成功。
- 遗留关闭检查：除安全修复或 Schema 兼容需要外不再发布 `webchat-config`、`webchat`、`webchat-attachment`、`webchat-image-cleanup` 或 `webchat-cache-probe`；如必须维护，部署后 `CHAT_ENABLED` 与所有产品入口仍为关闭。
- [ ] 数据库与函数部署后，严格运行 `npm run check:supabase-readiness`，不再允许待部署 migration、缺失函数或 `404` 边界。
- [ ] 发布记录包含当前 Git SHA 与 12 个 Edge Function 部署后版本号；黑盒就绪检查不作为源码一致性证明。
- [ ] `npm run check:supabase-readiness` 确认 12 个函数均使用预期 JWT/import map 配置，浏览器可调用函数精确允许正式 Pages Origin、不允许恶意 Origin，且匿名请求只返回预期的 `401`、`403`、`405` 或安全关闭状态。
- [ ] `npm run check:supabase-readiness` 确认数据库队列 Vault 配置完整、五分钟 cron active、最近 12 分钟有调度、最近 HTTP 为 2xx 且近 15 分钟至少一次 cron 成功。
- [ ] 仅对受控测试成员执行一次单平台同步，快照、运行记录、新鲜度和审计一致。
- [ ] Codeforces、牛客、AtCoder、XCPC ELO、洛谷、QOJ 的固定样本契约测试通过。
- [ ] QOJ 可恢复同步失败最多进入一次持久队列重试；每个 attempt 的临时 Firecrawl 会话都最终关闭，凭据/结构错误不重试。
- [ ] 已确认日更、周更和到期队列 cron 使用 UTC 表达正确的北京时间计划。

## 5. 凭据与外部服务

- [x] 生产首页递归发现的 64 个 JavaScript 分块均不含当前 service-role/secret Key 值、Fine-grained GitHub Token 或常见服务端 API Key 形态；公开 Supabase Key 继续作为允许的浏览器配置，证据见 `docs/evidence/production-security-final-audit-2026-07-25.md`。
- [x] `sync-stats.yml` 仅允许正式仓库默认分支运行，并绑定 `production-operations`；
      `SUPABASE_PROJECT_REF` 与 `SUPABASE_SERVICE_ROLE_KEY` 只存在于该 Environment，仓库级和
      组织级同名 Secret 副本均已删除，Environment 部署分支限制为默认分支。
- [ ] 洛谷 Cookie/CSRF、QOJ 服务账号和 Firecrawl key 均来自可独立轮换的生产 Secret。
- [ ] `SYNC_QUEUE_TOKEN` 使用独立随机值，Edge Secret 与 Vault 一致；Vault 和 cron catalog 均不含 service role key。
- [ ] 注销恢复 Token 只授权目标仓库 Variables write；`DELETION_RECOVERY_REPOSITORY` 指向正式仓库。
- [ ] `ALLOWED_ORIGIN` 只包含实际 Origin，不包含路径或通配敏感域。
- [ ] 生产凭据轮换人、存放位置和回滚方式已记录；未把真实值复制到发布记录。
- [ ] Firecrawl 用量、QOJ 登录、洛谷认证和 Supabase 配额均处于可用状态。
- [ ] 使用与生产 `FIRECRAWL_API_KEY` 相同团队的维护者凭据运行 `firecrawl credit-usage --json --pretty`；剩余比例高于 25%，或已记录扩容/降耗措施。不得把 API Key 或完整凭据配置写入发布记录。
- 遗留关闭检查：不再启用、更换或验收 WebChat 中转站；不运行付费兼容性或缓存探针。若仍保存旧 Key，只确认它位于 Vault 且三层开关关闭，不读取值、不轮换，也不得进入前端和日志；未来若删除，必须单独取得生产 Secret 变更批准。
- 历史记录：`npm run test:e2e:webchat` 曾通过五浏览器矩阵与并发、Abort、减少动画和移动端 axe 门禁；测试保留用于关闭态安全回归，不再推动功能开放。
- 遗留关闭检查：管理员后台继续保留 WebChat 配置页，只用于查看关闭状态、历史配置和历史用量；任何管理操作都不得绕过三层关闭边界产生新请求、修改配置或成员权限、预留 Token 或结算额度。历史账本继续保持私有且不可跨成员读取。
- 历史记录：`/assistant` 的模型、额度和私有账本隔离曾通过本地与 Pages 验证；生产现保持关闭。
- 关闭状态：数据库请求开关、`CHAT_ENABLED`、`VITE_WEBCHAT_UI_ENABLED` 和 `VITE_WEBCHAT_IMAGE_INPUT_ENABLED` 全部保持 `false`。不再保留“启用顺序”作为发布操作。

## 6. 前端与可访问性烟测

- [ ] 正式首页、榜单、成员详情、隐私页、注册、登录、账号页和后台可直达并刷新。
- 遗留关闭检查：普通注册页、成员账号页和主导航不展示推荐计划名称、邀请码、奖励摘要、AI 助手或暂停提示；管理员后台可继续显示遗留配置入口。关闭状态查询失败时成员端同样失败关闭。
- [ ] 访客、普通成员、停用成员和管理员看到的导航与路由符合权限。
- [ ] 部署后的只读生产门禁拒绝演示回退，并用公开视图和明确允许的只读 RPC 逐页复算全部成员在总榜与各平台榜的排序、柔性平台覆盖总 Rating 和总题数。
- [ ] 桌面、390px 移动端和至少一个宽屏视口无页面级横向溢出。
- [ ] 键盘可完成主要导航、筛选、平台标签、分页和高风险确认；焦点可见且顺序合理。
- [ ] 浏览器控制台没有与本次变更相关的 error/warn，分享元数据与方形图标可访问。

## 7. 法务、隐私与发布决定

- [ ] `PRIVACY.md`、站内隐私页、第三方数据来源和实际数据生命周期一致。
- 遗留隐私检查：生产不再向中转站或模型发送新消息；既有私有会话、额度账本和图片元数据仍按当前隐私页、注销和备份边界处理，直至数据自然清理或由成员删除。
- [ ] 已在运维手册核验并填写 Supabase、GitHub Actions 和 Firecrawl 的实际保留窗口、负责人及删除/恢复限制。
- [ ] 受控注销已验证三类结果：租约冲突/删除前续期失败或 GitHub 写入/确认失败返回 `503` 且 Auth 用户未删除；错误 owner/target、过期租约、管理员、活动同步或 Storage 所有权阻塞返回 `409` 或失败关闭且账号数据完整；成功时 Auth/Profile 级联、审计匿名化和租约消费在同一事务提交。
- [x] 使用两个数据库连接验证最终 RPC 的行锁 fencing：本地 CI 已证明竞争请求在删除事务结束前持续阻塞，提交后只能观察到已消费租约；响应丢失的 Auth/Profile 双重对账与失败关闭测试已覆盖，旧 access JWT 的生产 RLS 边界已有证据。2026-07-25 的生产最终 RPC 响应丢失复核成功，恢复正式函数后的完整注销耗时为 `6502 ms`，证据见 `docs/evidence/account-deletion-response-loss-production-2026-07-25.md`。
- [ ] 恢复工具拒绝早于当前注销恢复下限的备份，并拒绝仓库变量回退到备份 metadata 之前。
- [ ] 已按 [数据库备份与恢复方案](./backup-and-recovery.md) 使用当前 `main` 新生成的 Schema v2 真实 Artifact 运行手动 `Encrypted database restore drill`；演练完成来源/恢复下限、解密、动态归档白名单、单事务数据库恢复、8 项行数、7 类孤儿、私有 Bucket 重建、匿名访问拒绝、数据库引用与对象字节/哈希比对、3 个 Auth hooks、注册建档、密码登录、RLS、受控注销和明文/对象清理核对。旧 run `29656219433` 只覆盖 database-only 格式，可作为历史基线但不能替代本项。
- [ ] 已确认学校、集训队、ICPC 等名称和图形标识的使用授权范围。
- [x] 项目负责人已选择 Apache License 2.0（SPDX 标识符：`Apache-2.0`），维护 Agent 已加入 `LICENSE`。该许可证覆盖项目原创源代码，以及未附带其他授权声明的原创文档和配置；学校、集训队、赛事标识、第三方素材、成员数据和平台数据仍保持独立授权边界。
- [ ] 真实队员已小范围核对姓名、专业、年级、平台绑定和统计值。
- [ ] 已观察至少一个完整日更批次；涉及 XCPC ELO/QOJ 时观察到下一个周二批次。
- [ ] 所有阻塞问题已关闭，遗留非阻塞风险有负责人和后续日期。

## 8. 发布与观察

- [ ] 项目负责人明确给出发布决定后，才由执行 Agent 创建带注释的 `v1.0.0`（或对应版本）标签。
- [ ] 标签指向已通过全部门禁并实际部署的提交，不在失败构建上移动或复用标签。
- [ ] Pages、认证、后台、同步队列、同步失败状态和数据库指标在发布后观察窗口内正常。
- [ ] 若出现故障，已按 [生产运维手册](./operations-runbook.md) 执行 Git revert、函数兼容回滚或数据库前向修复。
- [ ] 发布记录包含验证证据、最终部署 ID、遗留风险和下一次 Agent 冷启动所需上下文。
