# 生产 RLS、管理员交接与最小权限最终复核（2026-07-25）

日期：2026-07-25（Asia/Shanghai）

本文不记录临时成员邮箱、密码、JWT、UUID、QQ、Supabase API Key、第三方凭据、WebChat 内容、训练目标主键或管理员目录内容。

## 可复跑检查器

新增 `npm run check:production-security`，固定检查 linked 项目 `qzggoqdmsvktrtnjislw` 与正式域名 `https://ustsacm.fun`。检查器：

- 通过 Supabase CLI 在内存中取得生产 anon/service-role Key，不写入文件、日志或报告。
- 创建随机普通成员、临时管理员和停用成员，所有数据库维护 SQL 只限定随机夹具 ID。
- 生产 Profile 触发器拒绝 service-role 通过 PostgREST 直接修改受保护字段，检查器确认错误码 `42501` 后，才使用 CLI 动态短期数据库登录初始化夹具。
- 所有临时账号最终通过正式 `delete-account` 注销；`finally` 对 Auth/Profile 独立对账，必要时最多进行一次有界人工清理重试。
- 输出只包含检查数量、生产 JS 分块数量、清理重试次数和清理确认布尔值。

## 生产身份与数据边界

最终权威运行通过 37 项检查：

- 未登录访客只能读取 `public_members` 的姓名、年级、专业和时间字段；停用成员不进入公开投影，直接读取 `profiles`、管理员 RPC 与运行时密钥 RPC 均被拒绝或返回空集。
- 普通成员可读取本人 Profile，不能读取另一成员 Profile、后台审计表、管理员目录、Firecrawl 运行时 Key 或 WebChat 中转站运行时配置。
- 停用成员可读取本人保留资料，但不能修改 Profile、调用管理员 RPC 或出现在公开成员投影。
- 临时管理员使用正式 `admin_set_member_role` 提升第二名成员；第二名成员在提升前签发的同一 JWT 立即获得管理员目录权限。第二名管理员随后降级第一名管理员，第一名管理员的旧 JWT 立即失去后台权限。
- 管理员按既定 RLS 可读取成员管理 Profile，但不能直接读取 `audit_logs`，不能调用 service-only Firecrawl/WebChat 密钥 RPC，也不能调用 `_unlimited` 管理实现。
- 被降级成员创建私有 WebChat 会话后，管理员不能按会话 ID读取、不能在自己的会话列表中看到，也不能通过个人数据导出取得该会话引用。
- 被降级成员拥有的私有训练目标只能由本人读取；管理员直接查询和 own-goal RPC 都不能取得该目标。
- 三名成员注销后，删除前签发的 JWT 都不能读取/修改 Profile 或调用管理员 RPC；Auth、Profile、活动同步任务和审计 UUID 引用均为零。

## 浏览器包 Secret 扫描

检查器从正式首页递归发现并下载 64 个生产 JavaScript 分块，在内存中与当前 service-role Key、Supabase secret Key 集合比对，并扫描 Fine-grained GitHub Token、常见服务端 API Key 格式：

- 真实 service-role/secret Key 值：未出现；
- Fine-grained GitHub Token：未出现；
- 常见服务端 API Key 形态：未出现；
- 公开 Supabase Key 仍属于允许进入浏览器的公开配置，不作为 Secret 处理。

## 运行结果与清理

最终运行输出：

```json
{
  "ok": true,
  "checksPassed": 37,
  "assetCount": 64,
  "cleanupFallbacks": 0,
  "cleanupConfirmed": true
}
```

检查器开发期间曾因夹具 QQ 唯一约束和匿名拒绝语义断言过严而提前退出；每次都先完成残留核对。一次提前退出留下的两个随机夹具随后通过正式 `delete-account` 返回 HTTP `200` 完成注销，Auth/Profile/训练目标夹具最终计数均为零。最终权威运行没有触发清理重试。

## 结论

当前生产 schema 下的访客、普通成员、停用成员、管理员、service role、即时角色交接、旧 JWT、WebChat/训练目标跨成员隔离和浏览器 Secret 值边界均已通过真实生产复核。`ROADMAP.md` 中“生产 RLS、管理员交接和最小权限最终复核”P0 可以标记完成。
