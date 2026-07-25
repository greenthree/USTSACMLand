# Firecrawl Key 池与 QOJ 生产烟测 — 2026-07-24

本文只记录聚合配置状态、标准错误分类、函数版本和布尔验收结果，不包含 Firecrawl API Key、QOJ 服务账号、成员身份、平台账号、目标 URL、浏览器会话 ID、请求正文或第三方页面内容。

## 生产基线

- Supabase 项目：`qzggoqdmsvktrtnjislw`，状态 `ACTIVE_HEALTHY`。
- 成功烟测函数：`sync-member` v50。格式化后的同逻辑源码随后以 v51 发布；v51 状态 `ACTIVE`，JWT 验证与仓库 import map 均开启。
- 数据库 Firecrawl Key 池共有 2 把 Key：2 把均存在 Vault Secret、已启用、已执行额度检查、健康状态为 `healthy` 且剩余额度大于 0。
- 两把 Key 均有运行时选择记录，使用不同优先级；受控冷却期间不可用 Key 被排除，恢复后重新进入选择范围。
- 牛客真实 Firecrawl 回退返回 `provider=firecrawl`、`sourceVersion=nowcoder-firecrawl-profile-v1` 和有效题数。

以上检查没有读取或输出任何 Secret 值。Key 的名称、ID、余额数值和目标成员也未写入本文。

## QOJ 诊断与修复

独立 Browser Sandbox 迁移后，首轮受控生产任务严格执行 `attempt=1/maxAttempts=2` 与唯一一次队列重试：

1. 首次 attempt 在 Firecrawl execute 传输阶段返回临时 `HTTP 502`。
2. 第二次 attempt 成功打开登录页并找到控件，但在 `login_submit` 后读取 DOM 时遇到 `navigation_error`。
3. 任务在第二次 attempt 后终止，没有第三次请求；既有题数、最近成功时间和来源版本均保留。

有效登录会替换页面执行上下文，原脚本在提交后立即读取 DOM，可能撞上短暂导航窗口。v50 改为只在同一次 Browser Sandbox 执行中等待并重新观察 DOM；不会再次填写或提交表单，也不会新建会话或发送第二个 Firecrawl execute 请求。失败诊断进一步区分 `fill_username`、`fill_password`、`click_submit` 和 `observe_result`，这些值均不含账号或页面内容。

## 最终成功烟测

v50 完成传播后创建一个新的、明确限定为单成员 QOJ 的逻辑任务，结果为：

- Edge Function 返回 HTTP `200`。
- 任务状态 `succeeded`。
- `attempt=1`、`maxAttempts=2`，未安排重试。
- 返回非空、非负的 `solvedCount`，来源版本为 `qoj-firecrawl-interact-v2`。
- 数据库原子提交 `commit_platform_sync_result` 成功，随后 `complete_sync_job_attempt` 成功。
- Firecrawl Key 健康观察写入成功。

Supabase `function_logs` 的只读查询在同一运行时间记录到 `qoj_firecrawl_session_cleanup_succeeded`。事件只包含本站内部 `syncRunId`；查询到的近期 QOJ 清理事件均为成功事件，没有会话 ID、账号、目标 URL 或响应正文。

## 自动化验证

- QOJ、统一平台契约和 Firecrawl 运行时定向测试：45 passed，0 failed。
- `sync-member` Edge Function 类型检查通过。
- 完整 Edge Function 回归：449 passed，0 failed，1 ignored。

## 错误密码、诊断发布与 Firecrawl 429

在不修改生产 QOJ Secret 的前提下，维护端使用专门生成的无效密码执行了一次真实 Browser Sandbox 登录演练。结果为不可重试的 `auth_expired`，会话清理成功；诊断阶段在本地进一步收紧为 `login_submit / observe_result`，避免把已经完成浏览器执行的凭据拒绝误标为传输阶段失败。

该诊断修正已发布为 `sync-member` v52；部署后函数为 `ACTIVE`，JWT 验证与仓库 import map 均开启。完整 Edge Function 回归仍为 449 passed、0 failed、1 ignored。

Firecrawl 官方 [Rate Limits](https://github.com/firecrawl/firecrawl-docs/blob/main/rate-limits.mdx#browser-sandbox) 文档没有提供 Challenge 或 `429` 专用测试模式，但明确说明 Browser Sandbox 的 `/interact` 有按套餐计算的每分钟限额，超过并发会话上限时新建会话也会返回 `429`。本次在非计划同步时段执行严格有界检查：最多创建 3 个空白、60 秒 TTL、禁用直播和录制的临时会话，不访问 QOJ；前两次返回 `200`，第三次返回 `429`，随后立即删除前两次会话，两次清理均返回成功。该检查没有继续加压，也没有通过请求洪泛制造限流。

真实 429 证明 Firecrawl 托管边界会按文档拒绝超限请求；固定样本与适配器测试进一步证明该响应映射为可重试的 `rate_limited`，单次 attempt 内不自动重发 create/execute，平台队列最多只安排一次后续 attempt。

## 受控 Challenge 演练

Firecrawl 没有可请求的 Challenge 测试开关，主动诱发 QOJ 或第三方站点的真实 Cloudflare 防护既不稳定也不合适。因此本轮使用真实 Browser Sandbox 创建一次禁用直播、录制和持久 profile 的短期会话，在远端浏览器内装载只含 `Just a moment`、`Checking your browser` 与 `challenge-platform` 标记的受控合成页面。该页面不发起 QOJ 或其他第三方导航。

因此本节证据只证明真实 Firecrawl 会话中的 Challenge 页面识别、生产错误分类和 finally 清理路径，不代表曾人为触发或观察到 QOJ 的真实 Cloudflare Challenge。

检查复用了生产 `createFirecrawlQojProvider` 的真实会话创建、execute 响应解析、QOJ challenge 分类和 finally 清理路径，只在诊断 fetcher 中把 execute 代码替换为受控页面生成器。结果为：

- `challengeClassified=true`；
- 错误类别 `source_unavailable`，`retryable=true`；
- 会话清理状态 `succeeded`；
- 输出不含 API Key、会话 ID、账号、URL、页面正文或第三方响应。

可复核命令为 `npm run check:qoj-firecrawl-challenge`。该命令只允许读取 `FIRECRAWL_API_KEY` 并访问 `api.firecrawl.dev`，不会读取 QOJ 服务账号或密码。

## 结论与剩余边界

生产 Firecrawl Key 的额度/启用状态、轮换与冷却、牛客 Firecrawl 回退、QOJ 有效登录、题数持久化和会话清理均已获得生产证据，因此 ROADMAP 中首个 Firecrawl/QOJ P0 条目可以标记完成。

生产有效登录、错误密码、真实 Firecrawl `429`、受控 Challenge 分类和会话清理均已完成验证，因此 ROADMAP 中第二个 Firecrawl/QOJ P0 条目可以标记完成。

2026-07-25 已补充部署 `sync-member` v53（`verify_jwt=true`、`import_map=true`），包含 QOJ 页面 HTTP 状态不误映射为 Firecrawl Key 认证失败的修复；本地 QOJ 回归与完整 Edge 测试均已通过。
