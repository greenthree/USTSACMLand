# 生产运维手册

本文供 USTS ACM Land 的项目维护者使用，覆盖部署、验证、回滚、凭据轮换、数据源修复和管理员交接。所有命令均在仓库根目录执行；示例中的项目引用、邮箱和 URL 必须替换为当前生产配置，禁止把真实 Secret 写入命令历史、工单、截图或 Git。

## 1. 权限与职责

至少保留两名维护者，但日常只使用完成任务所需的最小权限：

| 角色         | 必需权限                                         | 禁止事项                                |
| ------------ | ------------------------------------------------ | --------------------------------------- |
| 前端维护者   | GitHub 仓库写入、Pages 工作流读取                | 不接触第三方抓取凭据或 service role key |
| 数据库维护者 | Supabase SQL Editor、migration、备份恢复         | 不在浏览器前端配置 service role key     |
| 同步维护者   | Edge Function 部署、Function Secrets、同步健康页 | 不下载或传播成员私有资料                |
| 集训队管理员 | 网站后台                                         | 不直接操作数据库表，不共享个人登录会话  |

生产变更至少记录：变更人、关联提交、开始/结束时间、受影响组件、验证结果和回滚判断。高风险数据库与凭据变更建议由第二名维护者复核。

### 生产保留窗口登记

正式发布前必须由对应维护者在供应商控制台核验并填写下表。任何“待核验”项都属于发布阻塞，不得用供应商默认值或推测值代替。

| 服务与数据                          | 实际保留窗口                             | 核验日期与负责人          | 删除/恢复能力与限制                                                          |
| ----------------------------------- | ---------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| Supabase 数据库备份 / PITR          | PITR 未启用，可用物理备份 0 份           | 2026-07-15 / 自动只读检查 | `walg_enabled=true` 不等于存在可恢复备份；正式发布必须依赖并演练加密逻辑备份 |
| Supabase Auth / Edge Functions 日志 | 待核验（发布阻塞）                       | 待填写                    | 待填写                                                                       |
| GitHub Actions 日志与 artifact      | 仓库默认 90 天；备份 Artifact 单项 14 天 | 2026-07-15 / GitHub API   | 建议把仓库默认值降至 30 天以内；备份 workflow 的 14 天覆盖值仍需首次运行核验 |
| Firecrawl 作业与会话记录            | 待核验（发布阻塞）                       | 待填写                    | 待填写                                                                       |

数据库备份的文件范围、加密参数、Secret 配置和隔离恢复步骤见 [数据库备份与恢复方案](./backup-and-recovery.md)。数据库 Artifact 不包含 Supabase Storage 文件对象。

本项目已选择“禁止恢复到最近一次注销事件之前”的策略。`delete-account` 的目标绑定数据库租约必须覆盖完整临界区：取得 owner/target 租约 → 使用仅有目标仓库 Variables write 的 fine-grained PAT 更新 `BACKUP_RECOVERY_NOT_BEFORE` 并回读确认 → 续期并停止外部阶段心跳 → 调用最终删除 RPC。RPC 对租约行和目标 Profile `FOR UPDATE`，重新验证 owner、target、有效期、角色与活动同步，设置事务内 fence 标记，并在同一事务删除 `auth.users` 与消费租约；Auth 触发器拒绝没有匹配标记的旧 HTTP/旁路删除，使 migration 与 Edge Function 的部署切换也保持失败关闭。租约取得、删除前续期或恢复记录失败时不得进入最终 RPC，并返回 `503`；管理员、活动同步、Storage 所有权或其他受控约束拒绝删除时返回 `409`。最终事务由数据库行锁 fencing，不依赖 Edge Runtime 定时器；响应传输失败时不得声称“账号确定未删除”，应在重新登录/查询后确认最终状态。该变量不含成员身份，只保存带一小时并发/时钟安全余量的 UTC 恢复下限。

恢复时从 GitHub 当前变量复制值，以 `npm run verify:backup-recovery-floor -- restored-backup/metadata.txt` 检查备份。备份早于当前下限或仓库变量比备份 metadata 中的下限更旧时，恢复工具必须拒绝。生产 Secret、变量更新、失败关闭和隔离恢复尚未真实演练前，正式发布仍保持阻塞。

## 2. 发布前检查

每次发布先复制并填写 [正式发布检查单](./release-checklist.md)，本节只列出不能省略的核心步骤。

1. 确认工作树只包含本次发布内容，没有凭据、临时截图或本地导出数据。
2. 确认 `ROADMAP.md` 中对应功能的 migration、类型和文档已同步。
3. 本地执行：

   ```powershell
   npm ci
   npm run format:check
   npm run lint
   npm run check:sync-workflow
   npm run check:webchat-relay-workflow
   npm test
   npx playwright install chromium firefox webkit
   npm run test:e2e
   npm run build
   npx --yes deno check --config supabase/functions/deno.json supabase/functions/sync-member/index.ts supabase/functions/sync-stats/index.ts supabase/functions/delete-account/index.ts supabase/functions/change-password/index.ts supabase/functions/webchat/index.ts supabase/functions/webchat-config/index.ts
   npx --yes deno lint --config supabase/functions/deno.json supabase/functions
   npx --yes deno test --allow-read --allow-env --config supabase/functions/deno.json supabase/functions
   git diff --check
   ```

4. `CI / verify`、`CI / database-security` 和 `Secret scan / gitleaks` 必须通过；不得因为本机缺少 Docker 而跳过数据库门禁后直接部署。
5. 记录当前可用版本：Git 提交、Pages 部署 ID、Supabase migration 列表和 Edge Function 版本时间。

## 3. 标准部署顺序

默认部署顺序为“数据库 → Edge Functions → GitHub Pages”。若 migration 会立即启用新的数据库事件生产者（例如 queue cron），则先配置 Secret/Vault 并部署向后兼容的 Edge 消费者，再应用启用生产者的 migration；这类例外必须在发布记录中说明，避免 cron 在消费者尚未支持新鉴权时持续失败。

### 3.1 数据库

先运行只读部署前预检；它核对 linked 项目健康状态、远端独有 migration、已部署函数的 JWT/import map、远端 `public` schema lint、全部必需 Secret、公开 Auth 注册/邮箱自动确认设置、匿名 REST 权限和现有函数边界。预期要应用的本地 migration 和尚待首次发布的函数只作为 warning 展示，不会造成部署流程死锁：

```powershell
npm run check:supabase-preflight
```

该命令退出码为 `1` 时不得继续发布。先处理缺失 Secret、远端独有 migration、项目健康、权限或 schema lint 等真正的前置阻塞；待部署 migration 与函数本身会保留为 warning。

2026-07-16 的只读生产探测确认 `sync-member` 与 `sync-stats` 对 `https://greenthree.github.io` 的预检返回精确 `Access-Control-Allow-Origin` 和 `Vary: Origin`，对 `https://attacker.example` 不返回允许源，匿名 GET 返回 `401`。尚未部署的 `delete-account` 以 `404` 失败，新增 `change-password` 也尚未部署，因此发布门禁保持阻塞；部署后必须重新运行检查，不能用另两个函数的通过结果替代。

先核对本地与远端 migration，不直接在生产 SQL Editor 手工粘贴仓库 migration：

```powershell
npx --yes supabase@2.109.1 migration list --linked
npx --yes supabase@2.109.1 db push --linked --include-all --dry-run
```

检查 dry-run 仅包含预期文件后再执行：

```powershell
npx --yes supabase@2.109.1 db push --linked --include-all
npx --yes supabase@2.109.1 migration list --linked
```

2026-07-16 已用 CLI `2.109.1` 对正式 linked 项目重新执行只读 migration list 与 dry-run，结果按顺序包含 `202607140008` 至 `202607160007` 共 17 个仓库 migration，最后一项为注销租约续期。该证据只证明发布集合与顺序，不证明 migration 能在空库成功执行，也不能替代 `CI / database-security` 的 pgTAP 结果。

部署后验证：

- migration 列表本地与远端一致。
- 普通成员和停用成员无法调用任一浏览器可达管理员 RPC 或读取后台私有表；数据库测试清单必须与全部 `admin_*` 函数目录一致，`_unlimited` 实现不得授予浏览器角色。
- 管理员能读取后台，但写操作仍经过乐观锁、审计和速率限制。
- 公共榜单、成员详情与公告视图不暴露邮箱、QQ、错误原文或 Secret。

若 migration 因历史账号冲突或前置条件失败而停止，先按错误提示修复数据，再重新执行；不要删除约束、跳过检查或手工标记 migration 已完成。

### 3.2 Edge Functions

显式使用仓库 import map：

```powershell
npx --yes supabase@2.109.1 functions deploy sync-member sync-stats delete-account change-password `
  --use-api --import-map supabase/functions/deno.json
```

WebChat 不随其他函数直接启用。首次部署或更换中转站前，先在 GitHub Actions Secrets 中配置 `CHAT_RELAY_BASE_URL`、`CHAT_RELAY_API_KEY`、`CHAT_RELAY_MODEL`，手动运行 `WebChat relay compatibility`，并下载检查 14 天保留的脱敏报告。只有非流式、typed SSE、Usage 和 Abort 四项均通过后，才应用 WebChat 配额、成员授权与配置 migration，部署 `webchat-config` 与 `webchat`，然后由管理员在 `/admin/webchat` 写入同一组 Base URL、模型和 Key，设置全站北京时间每日请求/Token 预算，并继续保持“允许成员发起 AI 请求”关闭。Key 只进入 Supabase Vault；保存后页面必须清空密钥输入框，刷新时只能看到配置状态、开关、预算、版本和更新时间。随后在成员详情中只为 3–5 名试运行成员打开“允许使用 AI 学习助手”，逐人设置每日请求与 Token 上限并填写原因；无授权行默认拒绝，停用账号与非普通成员始终无效。成员端 `/assistant` 应只显示自己的当日已用、预留、剩余和北京时间重置时间。此时保持 `CHAT_ENABLED=false`，先验证环境禁用态 `503`、数据库暂停态 `503`、CORS、匿名拒绝、管理员配置边界、成员默认拒绝、撤权/降额竞态、逐人及全站预算边界。完成真实中转站、额度和隐私验收后，先受控设置 `CHAT_ENABLED=true`，再由管理员打开数据库请求开关，最后在下一次前端 Pages 构建中设置 `VITE_WEBCHAT_UI_ENABLED=true`。`CHAT_RELAY_*` 与 `CHAT_GLOBAL_*` Supabase Function Secrets 只在数据库 RPC 没有返回中转站配置行时作为部署引导/应急回退；成员每日额度没有环境变量回退。数据库配置行一旦存在，后台暂停开关和预算始终优先，启用状态下缺少地址、模型或 Vault Key 会失败关闭。任一阶段失败时立即关闭数据库请求开关，并按需要恢复 `CHAT_ENABLED=false` 与 `VITE_WEBCHAT_UI_ENABLED=false`；不能只隐藏导航而继续让后端消费模型额度。完整步骤见 [WebChat 中转站兼容性验收](./webchat-relay-compatibility.md)。

Pages 的客户端开关使用 GitHub 仓库变量 `VITE_WEBCHAT_UI_ENABLED`，只接受小写 `true` 或 `false`；未配置时 workflow 固定回退为 `false`。生产客户端从同一次构建的 `VITE_SUPABASE_URL` 推导当前项目的 `/functions/v1/webchat`，不得用覆盖 URL 把成员 Supabase 登录 Token 发送到其他域名。

WebChat 部署后还要核对 `/admin/webchat` 的当天请求数、已结算 Token、正在预留 Token、剩余额度和下一次北京时间 00:00 重置时间。使用隔离数据分别触发请求/Token 首次阻断，接收端应各收到一次 `webchat_budget_exhausted`；同一天的并发后续阻断不得重复投递。告警 Payload 只能包含日期、预算种类、上限、聚合用量和时间，不得包含成员、请求、消息、模型内容、中转站地址或 Key。接收端超时/`503` 时原 WebChat 请求仍应返回额度 `503`，且不得自动重试或放行。

部署后执行受控烟测：

0. 先运行 `npm run check:supabase-readiness` 严格验收；任何待部署 migration、缺失函数、错误 JWT/import map 或函数边界都会阻塞后续 Pages 发布。
   该检查是远端状态与黑盒边界验证，不能证明函数源码与当前 Git 提交逐字一致；发布记录还必须保存本次提交 SHA、部署时间和四个函数部署后的版本号。

1. 用管理员账号同步一个测试成员的单个平台。
2. 确认成功运行、快照、数据状态与审计记录一致。
3. 连续触发达到限流阈值前停止；确认正常请求不会返回 429。
4. 对 QOJ 只做一次明确授权的健康检查，禁止自动重试。
5. 确认日志不含姓名、邮箱、QQ、平台账号、Cookie、Token 或第三方响应正文。
6. 在隔离或受控测试账号上验证注销失败语义：租约冲突、删除前续期失败及 GitHub 写入/确认失败均返回 `503` 且 Auth 用户仍存在；错误 owner、错误 target、过期租约、管理员、活动同步和 Storage 所有权阻塞均不得删除；最终 RPC 期间用第二连接尝试接管租约，确认其被行锁阻塞到删除事务提交/回滚；成功路径确认 Auth、Profile、绑定、统计、任务与刷新会话清理，旧 access JWT 也无法通过依赖 live Profile 的 RLS/RPC 读取或写入私有业务数据。

计划同步部署后还要手动触发一次包含牛客的多平台范围，确认 Actions 出现连续的 `Sync page N summary`，每页最多 3 个账号、游标持续前进、后续平台不会被前一平台阻塞，且不再出现 Supabase 网关超时。日志只能包含范围、平台、成功/失败聚合和是否有下一页，不得输出游标、成员 ID、平台账号、任务 ID 或第三方错误原文。QOJ 即使位于后续页也不得因 HTTP/curl 自动重试而产生第二次任务。

数据库队列 cron 还必须满足：`SYNC_QUEUE_TOKEN` 与 Vault 中 `sync_queue_scheduler_token` 一致；Vault 同时存在固定 Edge URL 和公开 anon key；`read_sync_queue_scheduler_health()` 显示 cron active、最近 12 分钟有调度、最近已完成 HTTP 为 2xx 且近 15 分钟至少一次 cron 成功。GitHub 不运行第二个自动队列调度器；数据库 cron 故障时，由管理员在工作流中手动选择 `queue` 作为应急恢复入口。

### 3.3 GitHub Pages

`deploy-pages.yml` 不再独立监听 `push`。只有 `main` 上由 push 触发的 `CI` workflow 完整结束且结论为 success 时，Pages workflow 才会检出该次 CI 的精确 `head_sha`，重新执行格式、Lint、测试和构建。数据库安全任务失败或 CI 被取消时不会产生 Pages 部署。合并或推送后检查：

- `CI / verify` 与 `CI / database-security` 通过。
- `Deploy GitHub Pages / build` 通过后才产生新部署。
- `Deploy GitHub Pages / production-ranking-audit` 只读取公开 Supabase 视图，拒绝演示数据回退，并逐页复算全部公开成员的总榜与各平台榜。
- 正式首页、`/rankings`、登录页和一个成员详情直达链接均可刷新。
- `dist/404.html` 回退生效，站点图标与分享元数据可访问。
- 构建日志出现 `Verified production bundle budget`，入口 JS 未超过 500 KiB raw / 160 KiB gzip，六个关键路由块仍独立生成。
- 桌面、390px 移动端和 1920px 宽屏视口无页面级横向溢出，控制台无相关 error/warn。

## 4. 回滚策略

### 4.1 前端回滚

前端使用可审计的 Git revert，不强制改写主分支历史：

1. 确认最后一个正常提交。
2. 对故障提交创建 revert 提交并走正常 CI/Pages 部署。
3. 验证 Pages URL 与关键路由。

不要使用 `git reset --hard`、强推或直接覆盖 Pages 产物；这些做法会丢失审计线索并可能覆盖其他维护者的变更。

### 4.2 Edge Function 回滚

若数据库仍兼容旧函数，可在临时 worktree 检出最后正常提交并重新部署函数：

```powershell
git worktree add ..\ustsacmland-rollback <known-good-commit>
Set-Location ..\ustsacmland-rollback
npx --yes supabase@2.109.1 functions deploy sync-member sync-stats delete-account change-password `
  --use-api --import-map supabase/functions/deno.json
```

完成后回到主工作区并删除临时 worktree。若旧函数不兼容新 Schema，不回滚函数，改为从主分支发布最小修复版本。

### 4.3 数据库回滚

生产 migration 采用只向前修复：

- 尚未应用：停止部署，修正 migration 后重新跑空库 CI。
- 已应用但无数据破坏：新增后续 corrective migration，不修改已部署文件。
- 已发生数据破坏：立即暂停同步和管理写入，记录时间窗口，评估 Supabase PITR/备份恢复。
- 只有整库灾难恢复才考虑使用备份；必须先用 GitHub 当前 `BACKUP_RECOVERY_NOT_BEFORE` 运行恢复下限校验，再核对 Auth、业务表和审计匿名化状态。校验失败时禁止恢复旧备份。

恢复前不得覆盖唯一可用备份。所有恢复操作先在隔离项目演练，并保存恢复点、行数核对和抽样结果。

## 5. 凭据轮换

通用顺序是“创建新值 → 更新目标 Secret → 部署/重启消费者 → 烟测 → 撤销旧值”。不能先撤销旧值再开始配置。

2026-07-15 的只读 Secret 名称审计确认洛谷、QOJ、Firecrawl 与 `ALLOWED_ORIGIN` 已配置；`SYNC_ALERT_WEBHOOK_URL`、`SYNC_ALERT_WEBHOOK_TOKEN`、`DELETION_RECOVERY_REPOSITORY`、`DELETION_RECOVERY_GITHUB_TOKEN` 尚未配置。这四项补齐并完成告警/注销烟测前，不得宣称同步告警或安全注销已在生产可用。审计工具只读取名称，不输出 Secret 值或摘要。

| 凭据                      | 存放位置                                       | 轮换后验证                                                                                     |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Firecrawl API Key         | Supabase Function Secrets                      | 牛客回退一次、QOJ 登录健康检查一次、用量面板正常                                               |
| QOJ 服务账号密码          | QOJ + Supabase Function Secrets                | 单次登录、目标主页匹配、会话最终关闭；不重试失败请求                                           |
| 洛谷 Cookie + CSRF        | Supabase Function Secrets，必须成对更新        | 公开 UID 校验、Accepted 分页、仅 P/B 题去重                                                    |
| 同步告警 Token            | 接收端 + Supabase Function Secrets             | 受控终态失败仅投递一次，Payload 保持脱敏                                                       |
| 同步队列调度 Token        | Supabase Function Secret + Vault               | 暂停 cron 后同步轮换两处，手动调用与下一次 cron 均为 2xx                                       |
| Supabase access token     | GitHub Actions/维护者本机安全存储              | migration list 与函数部署只访问目标项目                                                        |
| Supabase service role key | Edge/GitHub 受控 Secret                        | 计划同步、队列领取和管理员函数正常；浏览器包中不存在该值                                       |
| WebChat 中转站 Key        | GitHub Actions（验收）+ Supabase Vault（运行） | 手动兼容性烟测、后台轮换、禁用态函数边界和受控成员试运行；前端包、配置读取与审计中均不存在该值 |
| Supabase 数据库密码/URI   | GitHub Actions Secret、密码管理器              | 手动备份 dry run 与一次受控加密备份成功；日志不含 URI                                          |
| 数据库备份加密口令        | GitHub Actions Secret、密码管理器              | 下载最新 Artifact，在隔离目录完成解密和 SHA256 校验                                            |
| 注销恢复下限 GitHub Token | Supabase Function Secret                       | 仅 Variables write；受控注销前后变量单调前移且不含身份信息                                     |
| 管理员密码                | Supabase Auth                                  | 新密码登录、旧会话按策略失效、恢复邮箱可用                                                     |

轮换后搜索近期日志只能检查字段名或错误码，禁止搜索并输出 Secret 本身。若凭据疑似泄露，先撤销、再调查影响范围；不要继续使用旧值“观察是否被滥用”。

轮换同步队列 Token 时，先暂停 `sync-queue-every-five-minutes`，生成新的独立随机值，更新 Edge Function Secret `SYNC_QUEUE_TOKEN` 和 Vault `sync_queue_scheduler_token`，手动调用私有调度函数并确认健康 RPC 返回 2xx，再恢复 cron。不要把 Token 作为 SQL 字面量写入 migration、SQL 历史、终端输出或发布记录；数据库只保存 Vault 密文，`net.http_request_queue` 中的专用 Token 会在异步请求完成后随队列行删除。

## 6. 数据源故障修复

先在后台“数据源健康”和“同步中心”确定平台、错误码、最后成功时间与是否已进入终态。抓取失败保留最后成功值，不得手工清零。

| 错误                 | 首要检查                              | 修复与验证                                     |
| -------------------- | ------------------------------------- | ---------------------------------------------- |
| `not_found`          | 用户账号、UID、姓名 + 学校匹配        | 管理员核对绑定；不得猜测或绑定同名 XCPC 选手   |
| `auth_expired`       | 洛谷 Cookie/CSRF 或 QOJ 服务账号      | 成对轮换后只烟测一次；QOJ 不自动重试           |
| `rate_limited`       | 第三方/Firecrawl 用量、并发和计划批次 | 等待窗口，降低并发或错峰；不增加无界重试       |
| `schema_changed`     | 固定样本与真实响应差异                | 保存脱敏最小样本，更新单个平台适配器和契约测试 |
| `timeout`            | 上游状态、网络和响应体大小            | 先确认单平台故障；只使用已有有限重试/持久队列  |
| `source_unavailable` | 上游 HTTP 状态与公告                  | 保留旧值并标记状态，不阻塞其他平台             |
| `not_configured`     | 对应 Function Secret 是否存在         | 补齐 Secret、重新部署消费者并烟测              |

平台专项：

- Codeforces：先检查 `user.info`，再检查 `user.status` 分页和题目唯一键。
- 牛客：先检查公开页面；只有反自动化响应才允许走 Firecrawl 回退。
- AtCoder：分别检查历史 Rating JSON 与 `user/ac_rank` 的 `count`。
- XCPC ELO：检查共享缓存版本、租约、源大小和“姓名 + 苏州科技大学”唯一命中。
- 洛谷：先核对公开 UID，再检查认证记录接口、增量边界和 30 天全量校准。
- QOJ：检查 Firecrawl 临时会话、登录态标志和目标用户名；失败不自动重试，可临时使用带审计原因的管理员手工题数。

修复完成后只重试受影响平台，确认其他平台没有被批量重复同步。

## 7. 管理员交接

后台成员管理提供受控角色交接，并遵循“先增加、验证，再移除旧权限”：

1. 新管理员先完成正常注册、邮箱恢复配置和资料填写。
2. 两名维护者核对目标邮箱与 Profile ID，不在聊天或截图中传播会话信息。
3. 在后台成员管理中选择目标成员，点击“设为管理员”，填写交接原因、核对权限影响并二次确认。
4. 新管理员登录并完成只读检查，再执行一次低风险、可审计操作。
5. 确认新管理员可用后，才在同一页面把离任管理员降为普通成员；数据库会串行化角色变化并拒绝移除最后一名启用管理员。
6. 轮换离任人员可访问的 GitHub、Supabase、Firecrawl、Webhook 和第三方服务凭据。
7. 保存交接清单，但不保存密码、Token、Cookie 或恢复码。

首次部署且数据库中完全没有管理员时，才允许使用一次性的：

```sql
select public.bootstrap_first_admin('new-admin@example.edu.cn');
```

已有管理员时该函数会拒绝执行，不能用它绕过正常交接。交接期间始终至少保留一个已验证可登录的管理员；管理员不能在交接前自助注销。

## 8. 发布后观察与事件关闭

发布后至少观察一个完整日更批次；涉及 XCPC ELO/QOJ 时观察到下一个周二批次。关闭变更前确认：

- Pages、认证、后台和公开榜单可用。
- 同步成功率、耗时、队列长度和终态告警符合预期。
- 没有新增凭据错误、结构错误、无限重试或重复快照。
- 数据过期规则按最近计划批次计算，没有把失败值写成 0。
- 变更记录包含验证证据、遗留风险和下一位值班维护者。

若无法证明恢复正常，保持事件开放并停止扩大变更范围。
