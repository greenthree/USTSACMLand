# 生产公告管理生命周期烟测证据（2026-07-17）

## 范围

- 仓库提交：`ac3f4a817de7ede67a3f9d13f62e86dc13ba6cb3`
- Pull Request：[#44](https://github.com/greenthree/USTSACMLand/pull/44)
- 生产 migration：`202607170001_announcement_conflict_http_status.sql`
- 生产项目：现有 USTS ACM Land Supabase 项目

本文不记录管理员邮箱、密码、JWT、用户 UUID、API Key、真实成员资料或公告夹具的随机标题。

## 验收前发现与修复

第一次生产乐观锁烟测使用旧 `updated_at` 调用公告更新 RPC。数据库正确保留了已发布正文，但 SQLSTATE `40001` 被 HTTP/数据库链路视为可重试的事务序列化失败，客户端等待 90 秒仍未收到响应。

PR #44 在浏览器可调用的公告更新和删除 RPC 边界捕获 `serialization_failure`，将预期的版本冲突转换为 PostgREST `PT409`。PostgreSQL 17 空库 CI 随后通过 16 个 pgTAP 文件、290 项断言，新增覆盖旧版本更新与旧版本删除；`verify`、`database-security` 和 `gitleaks` 均成功后合并。migration 部署到生产后，远端 schema lint 为 0 个错误。

## 生产生命周期结果

使用一个随机临时管理员和一条随机前缀公告完成以下真实 HTTP/RPC 检查：

1. 创建草稿返回 HTTP 200，匿名公开视图不可见；
2. 使用当前版本发布时间早于当前时间的公告返回 HTTP 200，匿名公开视图可见；
3. 使用草稿旧版本再次更新，在 369 ms 内返回 HTTP 409 和 `PT409`，正文与发布状态保持不变；
4. 使用当前版本设置未来两小时发布、三小时过期返回 HTTP 200，匿名公开视图不可见；
5. 使用当前版本归档返回 HTTP 200，匿名公开视图不可见；
6. 管理员 100 条列表 RPC 返回 HTTP 200，能看到该公告处于 `archived`；
7. 使用当前版本删除返回 HTTP 200 和 `true`，私有公告表及公开视图均无残留；
8. 审计表按顺序存在 `insert`、三次 `update`、`delete` 共五条动作。

本次检查同时证明草稿、即时发布、未来定时发布、归档、乐观锁、后台列表、删除和审计链路在生产环境真实可用。

## 临时数据清理

验收结束后，临时管理员先降级为普通成员，再通过目标绑定恢复租约和事务内 Auth 删除 RPC 清理。最终复核：

- 临时 Auth 用户：0；
- 临时 Profile：0；
- 随机烟测前缀公告：0。

公告审计记录按数据保留策略保留，但账号删除触发器已移除其中的个人标识。
