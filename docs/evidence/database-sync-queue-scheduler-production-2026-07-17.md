# 数据库同步队列调度器生产证据（2026-07-17）

## 范围

- 主分支提交：`1845004ac414bd42baf4373d864ca51587b20a0e`
- Pull Request：[#52](https://github.com/greenthree/USTSACMLand/pull/52)
- PR CI：[`29552379540`](https://github.com/greenthree/USTSACMLand/actions/runs/29552379540)
- 主分支 CI：[`29552560458`](https://github.com/greenthree/USTSACMLand/actions/runs/29552560458)
- 主分支 Pages：[`29552757654`](https://github.com/greenthree/USTSACMLand/actions/runs/29552757654)
- Supabase 项目：`qzggoqdmsvktrtnjislw`，`ACTIVE_HEALTHY`
- Edge Function：`sync-stats` v23，ACTIVE
- migration：`202607170004_database_sync_queue_scheduler.sql`，生产第 39 个 migration，0 pending

本文只记录 Secret 名称、非敏感状态和聚合计数，不记录 Token、JWT、service role key、请求头、响应正文、成员标识或平台账号。

## 发布门禁

PR 首次数据库任务发现 CI 中 pgTAP 不支持三参数 `unlike`，在执行到新测试文件第 5 项时停止；没有绕过门禁。断言改为 PostgreSQL 原生 `!~*` 配合 pgTAP `ok()` 后，第二次 CI 完整通过：

- `verify`：完整 Vitest、Playwright、构建、Deno check/lint 和 265 项 Edge 测试成功；
- `database-security`：PostgreSQL 17 空库按时间顺序应用 39 个 migration，18 个 pgTAP 文件、328 项断言成功；
- `gitleaks`：成功；
- 合并后的主分支 CI、Secret scan 和 Pages 均覆盖提交 `1845004` 并成功。

## 凭据边界与部署顺序

生产按“Secret/Vault → 向后兼容消费者 → 数据库生产者”顺序部署：

1. 生成新的独立随机 queue token，写入 Function Secret `SYNC_QUEUE_TOKEN`；
2. Vault 分别写入 `sync_queue_endpoint`、legacy public anon JWT 对应的 `sync_queue_anon_key`、与 Function Secret 一致的 `sync_queue_scheduler_token`，每个名称只有一份；
3. 先部署 `sync-stats` v23；首次 `--use-api` 因未显式传 import map 在服务端 bundling 阶段失败，生产函数未被替换；补充 `--import-map supabase/functions/deno.json` 后部署成功；
4. 最后应用 migration，安装/启用 `pg_cron` 与 `pg_net` 并创建五分钟 cron。

Vault 未保存 service role key。cron catalog 只保存 `select private.invoke_sync_queue_scheduler();`，Function Secret 与 Vault 值均未进入 Git、终端输出或本文档。

## 连续调度验证

部署后先通过数据库维护连接手动调用一次私有调度函数，随后观察两个真实 cron 周期。生产聚合结果：

| UTC 周期 | cron 状态   | pg_net HTTP |
| -------- | ----------- | ----------- |
| 03:40    | `succeeded` | `200`       |
| 03:45    | `succeeded` | `200`       |

03:45 周期后的 service-role-only 健康 RPC 返回：

- `configured=true`
- `cronActive=true`
- `lastDispatchedAt=2026-07-17T03:45:00.084694Z`
- `lastResponseDispatchedAt=2026-07-17T03:45:00.084694Z`
- `lastHttpStatus=200`
- `lastTimedOut=false`
- `lastTransportError=false`
- `recentCronRuns=2`
- `recentCronSuccesses=2`

同一时点的数据库聚合核对为：

- queued jobs：0
- running jobs：0
- pg_net pending request：0
- 近 15 分钟重复 `job_id + attempt`：0

GitHub workflow 已移除自动 `*/5` 表达式，只保留管理员手动 `queue` 应急入口，因此不会与数据库 cron 形成双主并突破平台并发上限。

## 严格就绪检查

部署后 `npm run check:supabase-readiness` 确认：

- 项目 `ACTIVE_HEALTHY`
- 39 个 migration，0 pending
- 四个 Edge Function
- schema lint 0
- Auth、匿名 REST 与 Edge 边界通过
- `queue scheduler readiness=true`

整条严格检查仍以退出码 1 结束，因为其他 ROADMAP 条目尚缺 `SYNC_ALERT_WEBHOOK_URL`、`SYNC_ALERT_WEBHOOK_TOKEN` 和 `DELETION_RECOVERY_GITHUB_TOKEN`；同时 Supabase 没有 PITR/物理备份。这些独立阻塞没有被本次调度器证据误报为完成。
