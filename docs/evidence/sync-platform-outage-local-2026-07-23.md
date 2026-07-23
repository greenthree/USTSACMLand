# 单平台停机组合演练证据（本地）

日期：2026-07-23

## 范围

这是一轮不访问第三方平台的本地 Supabase 组合演练。数据库 CI 通过 `npm run check:sync-platform-outage` 启动两阶段 Deno 检查，并把 Deno 网络权限限制为 `127.0.0.1:54321` 和 `localhost:54321`。Codeforces 使用连续两次返回 `source_unavailable/retryable` 的假适配器，AtCoder 使用成功假适配器。

## 验证结果

- 第一轮按真实 `sync-member` handler 和 `dispatchWithPlatformLimits` 执行，Codeforces 进入 `queued/attempt=1/max_attempts=2`，AtCoder 独立成功。
- 失败平台的活动任务使用成员+平台去重键，不阻塞同一成员其他平台的活动任务。
- 到期领取经过 `claim_due_sync_jobs`，Codeforces 进入 `attempt=2`；第二次失败经过 `complete_sync_job_attempt` 后进入最终 `failed`，再次领取不会产生第三次 attempt。
- 失败平台保留原 Rating、历史最高 Rating、题数、`last_success_at`、`source_observed_at` 和 `source_version`，仅记录 `source_unavailable`；成功平台写入新统计。
- `public_platform_stats` 和 `public_stat_snapshots` 均反映成功平台的新值与失败平台的保留值；平台账号身份未被改写。
- 每轮夹具都通过受控账户注销围栏删除 Auth、Profile、平台账号、任务、运行记录和快照。

## 限制

本证据不代表真实第三方平台停机窗口的生产结果，因此 ROADMAP 中的生产停机演练条目保持未完成。生产演练必须由管理员安排可回滚窗口，并确认不产生真实第三方写入或额外额度消耗。

`202607230005_sync_job_platform_isolation.sql` and
`202607230006_sync_worker_service_role_permissions.sql` were subsequently deployed, followed by
`sync-member` v47. Production readback confirmed the platform-isolation trigger, column-level
platform-account verification permission, and removal of direct Luogu checkpoint writes. A real
third-party outage window was not induced, so this remains local behavioral evidence rather than
completion of the ROADMAP production exercise.
