# 账号注销 Storage 所有权围栏本地证据（2026-07-23）

## 范围

本轮只修改本地仓库与本地 Supabase，不部署生产 migration，不创建生产 Bucket，
也不启用 WebChat 图片输入。围栏独立于尚未发布的图片功能，覆盖 Supabase
`storage.objects` 的通用所有权字段。

## 发现的问题

`storage.objects.owner` 与 `auth.users.id` 之间没有数据库外键；兼容字段
`owner_id` 也是文本。最终注销 RPC 直接删除 Auth 用户时，不能依赖外键自动拒绝仍有
Storage 对象的账号，否则可能留下无法再由原成员清理的孤儿对象。

仅在 Auth 删除触发器中执行一次无锁 `exists` 查询仍不充分：上传可以在该查询之后、
删除事务提交之前为同一用户写入新的 `owner_id`，而文本字段没有外键可在提交时再次
阻断，仍可能形成竞态孤儿。

## 实现

- 新增 `private.require_empty_storage_before_auth_user_deletion()` 安全定义者触发器函数。
- 新增 `private.require_live_auth_user_for_storage_ownership()` 安全定义者触发器函数；
  `storage.objects` 在插入或修改 `owner` / `owner_id` 前必须用 `FOR KEY SHARE` 锁定并
  确认对应 Auth 用户仍存在，两个所有权字段同时存在时还必须指向同一用户。
- 在 `auth.users` 的 `BEFORE DELETE` 阶段同时检查 UUID `owner` 与文本
  `owner_id`，任一字段仍归属目标用户即抛出 `object_in_use`。
- Storage 写入和 Auth 删除因此使用同一 Auth 行上的冲突锁：上传先取得锁时删除等待，
  随后观察到已提交对象并受控拒绝；删除先取得锁时上传等待，随后因 Auth 用户已不存在
  而以外键语义拒绝，不能提交孤儿对象。
- 触发器名称为 `auth_users_5_require_empty_storage`，排序在既有
  `auth_users_0_require_fenced_deletion` 之后；未持有恢复租约的旁路删除仍先由原围栏拒绝。
- `anon`、`authenticated` 与 `service_role` 均不能直接执行私有触发器函数。
- 既有最终 RPC 已捕获 `object_in_use` 并返回
  `leaseOwned=true, deleted=false`；Edge Handler 继续把该结果映射为受控 HTTP `409`，
  不删除 Auth、Profile 或恢复租约。

## 自动化验收

`48_account_deletion_storage_fence.test.sql` 使用真实本地数据库完成三次同租约尝试：

1. UUID `owner` 对象存在时删除被拒绝，两件对象、Auth、Profile 与租约均保留。
2. 删除第一件对象后，仅由文本 `owner_id` 归属的对象仍能阻止删除。
3. 两件对象均显式清理后，重试才删除 Auth、级联 Profile 并消费租约。
4. Auth 删除提交后，尝试以已删除用户的 `owner_id` 新建对象会以 `23503` 拒绝。

`scripts/check-account-deletion-concurrency.mjs` 另外执行真实双连接竞态：

1. 上传先插入对象并保持事务未提交，删除连接明确等待行锁；上传提交后删除返回
   `leaseOwned=true, deleted=false`，Auth、Profile、租约与对象四者都保留。
2. 删除先完成数据库删除但保持事务未提交，上传连接明确等待行锁；删除提交后上传以
   `23503` 失败，Auth、Profile、租约与对象四者计数都为 0。
3. 原有两个并发删除的租约消费与原子提交场景继续通过；所有测试会话都有数据库和
   进程级超时，并在 `finally` 中清理固定夹具。

Supabase 数据库会拒绝直接删除 `storage.objects` 并要求使用 Storage API。pgTAP
无法发起该 HTTP 调用，因此测试只在最终回滚的事务内短暂使用 replica mode 模拟 API
已完成对象删除后的 catalog 状态；生产清理路径不得使用该方式。

干净本地数据库已通过 48 个 pgTAP 文件、1205 项断言，扩展后的
`npm run check:account-deletion-concurrency` 也已通过三个双连接场景。测试结束后固定
Auth、Profile、恢复租约与 Storage 夹具计数均为 0。

生产环境随后已应用该 migration，并完成真实临时账号的 Storage `409` 烟测；生产证据见
[`account-deletion-storage-fence-production-2026-07-23.md`](./account-deletion-storage-fence-production-2026-07-23.md)。响应丢失复核和最终旧 JWT 边界仍未完成，因此 `ROADMAP.md` 对应 P0 总项继续保持未完成。
