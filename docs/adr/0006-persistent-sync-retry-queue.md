# ADR 0006：持久同步重试队列

- 状态：部分已替代；尝试次数和 QOJ 特例由 ADR 0008 取代，其余队列与并发设计继续有效
- 日期：2026-07-14

## 背景

同步任务原先在一次 HTTP 请求内完成。适配器虽然有网络级有限重试，但 Edge Function 中断或上游临时故障后没有可恢复的业务任务；直接无限重试又会放大 WAF、限流和 Firecrawl 用量。

## 决策

继续使用 `sync_jobs` 作为唯一任务来源，不增加第二套状态表：

- 单平台普通任务 `max_attempts = 3`，首轮失败后按 2 分钟、4 分钟指数退避。
- QOJ 和多平台直接请求 `max_attempts = 1`，不会自动重试。
- `claim_due_sync_jobs` 使用 `FOR UPDATE SKIP LOCKED` 原子领取到期任务并递增尝试次数，只授予 `service_role`。
- 每 5 分钟只由 Supabase `pg_cron` 通过 `pg_net` 以专用 queue token 自动调用 `sync-stats`；GitHub Actions 只保留管理员手动 `queue` 应急入口，避免双调度器突破平台并发上限。
- 超过 15 分钟仍为运行中的任务视为 Worker 中断：先将对应 `sync_runs` 关闭为 `timeout`，再重新排队；已达到最大次数则终止为失败。
- 批量任务按平台拆分。Codeforces/AtCoder 并发 2，XCPC ELO 并发 4，牛客/洛谷/QOJ 并发 1。
- `sync-stats` 调用单个 `sync-member` 时若发生传输层拒绝，将该目标转换为脱敏的 `network_error` 失败结果；同批其他目标和后续平台继续执行，不在传输层自动重发。已领取任务仍由 15 分钟 Worker 中断恢复规则接管，QOJ 同样不会立即重试。
- 管理员页面区分成功、等待重试和最终失败，不把已排队任务显示成同步成功。

## 安全边界

普通成员和管理员都不能调用队列 claim。`sync-member` 只有在 service role 请求携带的 `jobId`、成员、平台 payload 和数据库中已领取任务完全一致时才恢复该任务。活动任务唯一键继续阻止同一成员并发改号、解绑或重复同步。

## 后果

临时故障不会无限重试，Worker 中断也不会永久留下假运行状态。首次 fan-out 仍在触发请求中逐个平台创建任务；若成员规模继续增长，应再改为先批量入队、后完全异步消费。
