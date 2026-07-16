# ADR 0007：同步结果原子提交与 Rating 精度

- 状态：已实现，待空库 CI 与生产烟测
- 日期：2026-07-16

## 背景

非洛谷平台原先由 Edge Function 依次写入 `platform_stats`、`stat_snapshots` 和 `sync_runs`。每次 PostgREST 调用都是独立事务；若最后一步失败，当前统计和公开快照可能已经可见，但 run 仍为运行中或失败补偿也未成功。与此同时，XCPC ELO 上游允许小数 Rating，而统计表和共享缓存使用 `integer`，会在真实落库时拒绝或损失官网精度。

洛谷增量同步已经通过单个数据库 RPC 锁定账号和运行记录，并在同一事务中提交 checkpoint、统计、快照和 run 终态，提供了可复用的正确边界。

## 决策

- 新增仅授予 `service_role` 的 `commit_platform_sync_result`，处理除洛谷外的五个平台。
- RPC 先锁定并校验平台账号，再锁定匹配 job、成员、平台、账号且仍为 `running` 的 run；任一条件不满足即以 `40001` 失败。
- 当前统计、历史快照和 run 终态在同一数据库事务中提交。任何一步失败都会整体回滚，不公开半提交结果。
- 成功快照使用 `(profile_id, platform, source_observed_at)` 唯一键幂等；失败快照强制使用 `null` 源时间，保留每次失败的审计证据。
- 适配器失败时沿用最后成功的指标、源时间和源版本，只更新错误与新鲜度；从未成功过的账号保持 `unavailable` 和 `null`，不写成零。
- `platform_stats`、`stat_snapshots` 与 `xcpc_elo_cache_players` 的 Rating 改为 `numeric(12,2)`，保留 XCPC ELO 当前分和历史最高分的小数精度。其他平台的整数 Rating 仍可无损存储。
- Edge Function 的 best-effort run 失败补偿只更新仍为 `running` 的记录，不能覆盖已经成功、失败或跳过的终态。
- 洛谷继续使用包含增量 checkpoint 的专用 `commit_luogu_sync_result`，不经过通用 RPC。

## 验证

- Deno 测试固定时钟验证成功状态、失败保留、无历史不可用、RPC 参数和 XCPC 小数。
- pgTAP 验证 RPC 权限、成功与失败事务、同源幂等、终态竞争回滚、无历史语义和小数持久化。
- 本机没有容器运行时，因此 pgTAP 必须在 `CI / database-security` 空库任务实际通过后才能验收。

## 后果

同步结果写入增加一个数据库 RPC 和 migration，但消除了跨三次 HTTP 写入的半提交窗口。数值列改为定点小数后，前端仍使用 JavaScript `number`，现有整数平台无需特殊转换；数据库函数或管理界面若新增 Rating 参数，应继续允许两位小数并保持最大分不低于当前分的约束。
