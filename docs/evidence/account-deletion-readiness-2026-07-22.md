# 账号注销生产就绪核对 — 2026-07-22

本文不记录成员身份、密码、JWT、GitHub Token、Secret 摘要或数据库私有数据。

## 已确认

- Supabase 项目状态为 `ACTIVE_HEALTHY`，62 个 migration 已应用且远端无 pending migration。
- `delete-account` Edge Function v12 为 `ACTIVE`，启用 JWT 校验并使用仓库 import map。
- Function Secret 名称中存在 `DELETION_RECOVERY_REPOSITORY` 与 `DELETION_RECOVERY_GITHUB_TOKEN`；这替代了 2026-07-16 证据中“恢复 Token 尚未配置”的旧状态。
- 本地账号删除与密码变更 Deno 测试共 54 项通过，0 项失败。
- 自动化覆盖恢复下限单调更新、写入后回读确认、GitHub 错误失败关闭、目标绑定租约、续期、并发占用、最终 Auth 删除事务、管理员/活动同步拒绝和响应契约。
- 生产烟测最初使用已配置 Token 时，`delete-account` 返回 HTTP 503，恢复下限变量保持不变且两个账号均未删除，证明失败关闭生效。
- 将恢复下限提前写入仍然返回 503，确认旧 Token 无法完成目标仓库变量的读取或确认；随后将 Secret 轮换为已验证可读写该仓库变量的维护凭据。
- 两个随机临时生产成员均通过密码确认和 `delete-account` 成功注销，HTTP 200 且返回 `deleted: true`。
- 注销后两个 Auth 用户、两个 Profile、对应推荐码与绑定均不存在；推荐码总数回到 7、推荐绑定数回到 0、删除租约为 0。
- 维护端将 `BACKUP_RECOVERY_NOT_BEFORE` 单调前推并回读确认，记录不包含账号身份信息；生产函数随后成功读取该下限并完成注销。

## 尚未确认

- 当前可用维护凭据包含超出仓库 Variables 读写所需的权限；必须轮换为只授权目标仓库 Variables 读写的 fine-grained Token，并再次执行一次无数据残留的注销烟测。
- 本次恢复下限已提前约两小时，生产函数走的是“读取到足够新的下限”分支；为避免安全下限倒退，没有人为改回旧时间来强制触发写入。Edge 自主写入仍需在现有下限自然接近后复测。
- Storage 所有权阻断、受控约束 `409`、双连接锁、响应丢失对账和旧 JWT RLS 仍缺真实生产边界验收。

因此生产自助注销主路径已经可用，但 `ROADMAP.md` 的最小权限凭据条目继续保持未完成；下一次执行应先完成凭据收敛，再补齐剩余失败边界验收。
