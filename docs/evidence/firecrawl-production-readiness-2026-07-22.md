# Firecrawl 生产就绪核对 — 2026-07-22

本文只记录脱敏的配置状态、函数状态和聚合统计，不包含 Firecrawl API Key、QOJ 服务账号、成员身份、平台账号、请求体、Job ID 或第三方响应正文。

## 生产边界核对

- Supabase 项目：`qzggoqdmsvktrtnjislw`
- 项目状态：`ACTIVE_HEALTHY`
- 生产 migration：61，待应用：0
- Edge Functions：8 个，均为 `ACTIVE`
- Function Secret 名称：21 个，路线图要求的 Firecrawl 与 QOJ Secret 均存在
- schema lint：0 项
- Auth / REST / Edge Function 边界：通过

本次只读取 Secret 名称及脱敏摘要，未读取或打印任何 Secret 值。

## 线上统计观察

通过匿名公开统计视图进行只读观察：

- 牛客最近成功记录包含直连版本 `nowcoder-rating-history-practice-v1`，也包含 Firecrawl 回退版本 `nowcoder-firecrawl-profile-v1`。
- QOJ 最近成功记录均使用 `qoj-firecrawl-interact-v1`，状态为 `fresh`。
- 观察到的 QOJ 自动同步记录均保留非零题数和最近成功时间，没有发现失败后被写成 `0` 的记录。

这证明当前已部署函数能够写入并公开呈现最近的牛客/QOJ 成功快照，但不等同于额度接口或每个 Key 的后台状态检查已完成。

## 实现与固定样本验证

本地使用仓库 import map 执行 Firecrawl/QOJ/牛客相关 Deno 测试：

- 57 passed，0 failed
- 覆盖 Key 池选择、数据库 Key 优先级、额度告警阈值、单 Key 故障隔离、冷却/轮换选择、QOJ 临时会话关闭、登录失败、Cloudflare challenge、限流、目标用户匹配和单次 attempt 无自动重试。

## 尚未宣称完成的项目

以下项目仍需要管理员在受控生产环境中执行，因其会访问真实 Firecrawl 额度或第三方登录：

1. 对每个已启用 Key 执行一次额度检查，确认启用状态、剩余额度、冷却和轮换结果。
2. 使用脱敏的牛客回退和 QOJ 健康检查各执行一次，记录请求是否成功及会话是否关闭。
3. 使用无效 QOJ 凭据、Cloudflare challenge、Firecrawl `429` 做一次受控失败演练；确认失败分类、冷却和一次队列重试边界。

因此 `ROADMAP.md` 中 P0 Firecrawl/QOJ 条目继续保持未完成，不能仅凭本次只读观察和固定样本测试勾选。

## 2026-07-23 只读复核与可观测性补充

本轮没有部署函数、修改 Secret、触发同步任务或创建 Firecrawl 抓取会话。

- 使用维护环境中的单个 `FIRECRAWL_API_KEY` 调用真实额度接口成功：认证有效，并发占用为 `0/2`，额度为 `1348/1000`。该结果只证明当前环境 Key 可用，不代表数据库 Key 池中的所有 Key 已逐一检查，也不能证明轮换与冷却已在生产触发。
- Supabase 项目继续为 `ACTIVE_HEALTHY`，已部署的 8 个相关 Edge Function 均为 `ACTIVE`；Firecrawl 与 QOJ 所需 Secret 名称存在。检查过程未读取或打印 Secret 值。
- 匿名公开统计聚合显示：牛客 6 条公开记录均有成功值且当前无错误；QOJ 6 条公开记录均保留历史成功值，其中 2 条当前错误为 `source_unavailable`。本次没有读取成员身份或平台账号。
- 当前工作树为 QOJ 临时会话清理增加了事件 `qoj_firecrawl_session_cleanup_succeeded` 与 `qoj_firecrawl_session_cleanup_failed`。运行时事件只带本站内部 `syncRunId`，不含 Firecrawl Job ID、operation ID、账号或第三方响应正文；清理请求失败和日志 reporter 自身失败都不会覆盖主同步结果。Firecrawl Job ID 也已从适配器错误详情、函数响应和持久化诊断中移除。QOJ 适配器、运行时 Key 选择与同步 Handler 的定向 Deno 测试为 32 passed、0 failed。
- 上述清理事件尚未部署，所以只能证明本地实现与固定样本行为，不能作为生产会话已关闭的证据。生产部署后仍需从 Edge Function 日志核对事件，并在 Firecrawl Dashboard 或等价服务端记录中独立确认没有遗留活动会话。

## 2026-07-23 托管服务会话清理契约实测

使用维护环境中的单个真实 Firecrawl Key 创建一次受控临时会话，只访问 QOJ 公开登录页，不填写或提交任何 QOJ 凭据。随后执行只读取页面标题的无害 interact，并立即调用清理接口。全程只保留状态码和布尔契约字段，不记录 Key、Job ID、页面内容或响应正文。

- `POST /v2/scrape`：HTTP `200`，`success=true`，返回的 Job ID 通过 UUID 格式校验。
- `POST /v2/scrape/{jobId}/interact`：HTTP `200`，`success=true`，`exitCode=0`。
- `DELETE /v2/scrape/{jobId}/interact`：HTTP `200`，响应为 JSON、非空且 `success=true`。
- 额外对照确认：未先执行 interact 的普通 scrape 不存在可关闭的活跃交互会话，直接调用删除接口返回 `404`。这不是 QOJ 适配器的正常调用序列，不能据此放宽清理成功判定。

Firecrawl 当前 REST 文档同样声明成功删除响应包含 `success`。因此工作树中的清理实现继续严格要求 `success=true`，不接受空响应或单凭 2xx 判定成功。该实测确认了托管服务当前的成功响应契约，但没有执行 QOJ 登录，也没有覆盖数据库 Key 池轮换、错误密码、Cloudflare challenge、Firecrawl `429` 或部署后日志事件，所以 P0 条目仍不勾选。

由于数据库 Key 池逐 Key 检查、可控轮换/冷却、牛客 Firecrawl 回退、QOJ 真实健康检查和故障演练尚未全部完成，两个 P0 条目继续保持未勾选。

## 2026-07-23 deployment update

`sync-member` v47 has now been deployed with JWT verification and the repository import map. The
QOJ cleanup events use only the internal `syncRunId`, and Firecrawl Job IDs remain absent from
function responses and persisted diagnostics. This deployment closes the code-to-production gap
described above, but no new QOJ login was triggered in this step. Production log confirmation for
successful cleanup, invalid credentials, challenge, and `429` cases remains outstanding, so the
P0 items stay unchecked.

## 2026-07-23 controlled QOJ retry smoke

A single verified QOJ binding was selected without printing its member or account identity. The
deployed `sync-member` function returned the first attempt as a retryable `source_unavailable` and
queued `attempt=2/maxAttempts=2`; the database scheduler later claimed exactly the second attempt.
The job then reached terminal `failed` with no third attempt. The retained solved count,
`last_success_at`, and source version remained intact.

The two sanitized diagnostics were:

- attempt 1: Firecrawl browser session not found (`HTTP 404`);
- attempt 2: QOJ login form could not be loaded (`login_form`, unknown navigation error).

This confirms the production retry boundary and failure preservation, but indicates a
Firecrawl/QOJ session or upstream availability problem rather than a credential acceptance result.
A successful QOJ login, invalid-credential classification, Cloudflare challenge, per-Key
rotation/cooldown, and cleanup-event log verification are still required before the P0
Firecrawl/QOJ items can be checked.
