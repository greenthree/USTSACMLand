# 单平台停机受控生产演练 — 2026-07-24

本文只记录聚合结果和安全围栏，不包含临时成员 ID、邮箱、平台账号、任务 ID、服务密钥或 SQL 正文。

## 演练边界

- 生产项目：`qzggoqdmsvktrtnjislw`。
- 已部署函数：`sync-member` v52，状态 `ACTIVE`，JWT 验证与仓库 import map 均开启。
- 演练使用当前仓库的同一 `sync-member` handler 连接生产数据库与 RPC；Codeforces 使用连续返回 `source_unavailable/retryable` 的合成故障适配器，AtCoder 使用成功适配器，不访问任何第三方平台，也不消耗 Firecrawl 或 AI 额度。
- 2026-07-25 安全复核版先确认 Supabase CLI 唯一 linked 项目就是 `qzggoqdmsvktrtnjislw`；演练不暂停 `sync-queue-every-five-minutes`，也不调用全局领取 RPC，因此不会因同时发生的管理员同步、账号验证或手工 worker 误领真实成员任务。
- 夹具 setup 从请求发出前就进入强制清理范围；即使管理 API 响应丢失，finalizer 仍按随机夹具 ID 清理，并独立确认 Auth、Profile、平台账号、统计、任务、运行和快照均为 0，且 cron 保持 active。
- 使用随机临时成员、两个已验证的合成平台绑定和预置成功统计；演练完成后通过账号删除围栏级联清理。

## 验证结果

第一阶段同时派发两个平台：

- Codeforces 首次可恢复失败进入 `queued`，`attempt=1/maxAttempts=2`；
- AtCoder 在同一轮独立成功，写入新的 Rating、历史最高 Rating、题数和成功快照；
- 故障平台没有阻塞成功平台。

第二阶段在同一数据库事务中把唯一的合成 Codeforces 重试调整为到期，并使用同时限定夹具 `profile_id`、平台、状态和 attempt 边界的管理 SQL 定向领取；返回的唯一 job ID 经脚本和 Deno 测试双重核对后才执行：

- 领取结果为 `attempt=2/maxAttempts=2`；
- 第二次失败后任务进入最终 `failed`；
- 再次领取没有产生第三次 attempt；
- Codeforces 原有 Rating、历史最高 Rating、题数、`last_success_at`、`source_observed_at` 和 `source_version` 全部保留，只更新失败状态；
- 匿名公开统计与快照同样保留故障平台旧值，并显示 AtCoder 新值。

## 清理与恢复核验

演练命令返回：

```json
{ "ok": true, "environment": "production", "fixtureCleaned": true }
```

结束后的独立只读对账确认：

- 临时 Auth 用户：0；
- 临时 Profile：0；
- 临时平台统计：0；
- 生产 `running` 同步任务：0；
- `sync-queue-every-five-minutes`：active。

可复核命令为 `npm run check:sync-platform-outage:production`。该命令默认失败关闭：linked 项目不唯一或不是固定生产项目、定向领取没有恰好返回一个夹具 job、清理后仍有任一夹具行或 cron 非 active 时均失败；生产 SQL 和凭据在失败消息中始终脱敏。

2026-07-25 使用安全复核版再次执行，两个 Deno 阶段分别通过，最终输出 `{"ok":true,"environment":"production","fixtureCleaned":true}`。本次没有暂停 cron、没有调用全局领取 RPC，脚本内置的清理后独立对账通过。随后部署 `sync-member` v53（`verify_jwt=true`、`import_map=true`）并再次执行同一生产演练，结果仍为通过且夹具清理完成。

## 结论

生产数据库、夹具定向领取、重试围栏、统计持久化、公开投影、账号清理和 cron 持续可用均已在受控生产边界验证。由于第三方适配器为合成故障，本次不会主动破坏真实平台服务，但已经证明单个平台持续不可用时，其他平台继续更新、失败平台保留最后成功值且最多只执行一次重试。因此 ROADMAP 对应 P0 可以标记完成。
