# 账号注销响应丢失生产复核（2026-07-25）

日期：2026-07-25（Asia/Shanghai）

本文不记录临时成员邮箱、密码、JWT、UUID、Function Secret、GitHub Token、恢复下限原值或 Secret 摘要。

## 验收目标

验证生产 `delete-account` 在最终数据库 RPC 已成功提交、但 Edge 侧未取得该 RPC 响应时，能够通过 Auth/Profile 双重只读对账确认提交结果，而不是错误地报告失败、重复删除或留下临时成员数据。

## 受控故障注入

- 在本地对正式源码增加一次性故障注入包装器，并先通过 Deno check 与注销函数 45/45 项测试。
- 包装器只在请求头匹配随机 Function Secret 时启用；它先等待真实 `delete_auth_user_with_recovery_lease` RPC 返回成功，再主动丢弃结果并抛出受控传输错误。
- 故障发生在生产数据库已提交 Auth 删除、Profile 级联和恢复租约消费之后，因此覆盖的是 Edge 到 PostgREST 的最终 RPC 响应丢失，不是浏览器到 Edge 的普通超时。
- 使用随机普通成员夹具调用生产 `delete-account`。恢复下限仍由正式 GitHub Variables 路径记录并回读，密码确认、活动同步检查、租约续期和最终事务均走正式生产实现。

## 结果

- 受控响应丢失发生后，正式对账逻辑确认 Auth 用户与 Profile 均不存在，函数返回 HTTP `200` 和 `deleted: true`。
- `fallbackCleanupUsed=false`，证明本轮没有依赖第二次注销或维护端兜底删除来取得成功结果。
- 最终只读核对确认 Auth 用户、Profile 和活动同步任务均为零。
- 随后恢复无故障注入的正式函数，并使用第二个随机普通成员测量完整生产注销：HTTP `200`、`deleted: true`，端到端耗时 `6502 ms`，Auth/Profile 均归零。
- 临时故障注入没有提交到 Git；正式 `delete-account` 已重新部署为版本 18，状态 `ACTIVE`，`verify_jwt=true` 且使用仓库 import map。
- 临时 `ACCOUNT_DELETION_RESPONSE_LOSS_SMOKE_TOKEN` 已从生产 Function Secrets 删除，并通过只读列表确认不存在。

## 结论

生产环境已证明最终删除事务在响应丢失后可由 Auth/Profile 双重只读对账安全确认；正常完整提交耗时也已记录。结合既有 Storage `409`、双连接锁与旧 JWT RLS 证据，`ROADMAP.md` 中对应的注销边界 P0 可以标记为完成。
