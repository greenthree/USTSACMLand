# 账号注销响应对账与双连接围栏证据（2026-07-23）

日期：2026-07-23（Asia/Shanghai）

## 范围

本轮只验证本地注销事务边界和 Edge 响应丢失对账，不修改生产数据库、生产 Auth
用户、GitHub 恢复下限或 Function Secret。

## 响应丢失对账

`delete-account` 最终 RPC 抛出传输错误、返回错误对象或返回损坏契约时，会并行执行
两项只读核对：

1. 通过 service-role Auth Admin API 按目标 ID 查询 Auth 用户；只有明确
   `user_not_found` 或成功返回 `user: null` 才视为不存在。
2. 通过 service-role 数据库客户端按同一 ID 查询 `public.profiles`；只有无查询错误且
   `maybeSingle()` 返回 `null` 才视为不存在。

仅两项都明确不存在时，Edge 把歧义响应对账为已提交删除。Auth 或 Profile 仍存在、
两侧状态分裂、查询抛错、数据库错误或只有 HTTP 404 而没有稳定
`user_not_found` 错误码时，都重抛原始 RPC 错误，不能把未知状态报告为成功。

专项 Deno 测试覆盖已提交但响应丢失、事务未提交、Auth/Profile 两种分裂方向、Auth
查询失败、Profile 查询失败、模糊 404、RPC error 对象和损坏响应契约。

## 双连接验证

`scripts/check-account-deletion-concurrency.mjs` 在本地 PostgreSQL 17 Supabase 容器中：

1. 创建隔离夹具成员、私有 Bucket 并取得目标绑定恢复租约。
2. 连接 A 调用最终删除 RPC，在同一数据库事务内删除 Auth、级联 Profile、消费租约，
   随后短暂保持事务未提交。
3. 连接 B 使用相同 owner/target 调用最终 RPC；通过 `pg_stat_activity` 明确观察到 B 的
   `wait_event_type = 'Lock'`，而不是依赖执行时长猜测等待。
4. A 提交后 B 才继续，并返回 `leaseOwned=false, deleted=false`；B 不能接管或重复已提交
   删除。最终 Auth、Profile 和目标租约计数均为 0。
5. 上传先于删除和删除先于上传的两个 Storage 竞态也使用真实双连接验证：前者提交后
   删除保留 Auth/Profile/租约/对象，后者提交后上传因 Auth 所有者不存在而失败，最终
   四类记录均不存在。
6. 所有会话使用 `statement_timeout`、`lock_timeout` 和进程硬超时；`finally` 终止测试
   会话并清理夹具。若本地已有其他注销租约，脚本拒绝执行而不会覆盖该状态。

Supabase/Postgres 并发规则用于保持固定锁顺序、缩短真实写事务并为锁等待设置有界
超时；测试中额外的短暂停留只用于可观测地证明连接 B 确实阻塞，不属于生产路径。

## 结果

- `npm run check:account-deletion-concurrency`：通过，真实观察到并发删除以及两个方向的
  Storage/Auth 竞态等待，并证明不会留下孤儿对象。
- 注销 Edge Function 测试：45/45 通过。
- 响应对账专项测试：7/7 通过。
- Deno check 与 lint：通过。
- 并发检查器 Vitest：7/7 通过。
- ESLint、Prettier、生产构建和 `git diff --check`：通过。

## 未完成边界

- 生产 Storage 所有权阻断和受控约束 `409` 已使用随机临时成员验收；清理对象后第二次注销成功且所有临时状态归零，见 [`account-deletion-storage-fence-production-2026-07-23.md`](./account-deletion-storage-fence-production-2026-07-23.md)。
- 生产传输层响应丢失仍需在不会误删真实成员的受控临时账号上复核。
- 注销恢复 Token 仍需收敛为只授权目标仓库 Variables 读写的 fine-grained Token。

因此 ROADMAP 的注销边界条目继续保持未完成。
