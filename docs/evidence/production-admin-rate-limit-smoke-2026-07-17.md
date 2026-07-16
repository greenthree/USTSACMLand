# 生产管理员限流烟测证据（2026-07-17）

## 范围

- 仓库提交：`274791aec1049fadc3dc74f4b60d2bc9321de469`
- Pull Request：[#46](https://github.com/greenthree/USTSACMLand/pull/46)
- 生产 migration：`202607170002_admin_rate_limit_http_status.sql`
- 部署函数：`sync-member`、`sync-stats`
- Pages 运行：[`29518231537`](https://github.com/greenthree/USTSACMLand/actions/runs/29518231537)

本文不记录临时管理员邮箱、密码、JWT、用户 UUID、API Key、真实成员资料或限流桶主体标识。

## 修复内容

原有固定窗口计数器可以拒绝超额请求，但数据库 RPC 使用通用 PostgreSQL 错误，Edge Function 的 429 响应没有标准 `Retry-After` 头，前端 RPC 提示也没有读取数据库已经返回的等待秒数。

PR #46 完成以下修复：

- `consume_admin_rate_limit` 超额时使用 PostgREST `PT429`；
- 保留脱敏 `retry_after_seconds` 结构化详情；
- `sync-member` 和 `sync-stats` 的限流响应同时返回 JSON 等待秒数和 `Retry-After` 响应头；
- 后台 RPC 错误提示解析等待秒数，不显示内部 action key；
- CI 把新 migration 加入受保护发布集合。

PR 的 `verify`、`database-security` 和 `gitleaks` 全部通过。PostgreSQL 17 空库 CI 继续通过 16 个 pgTAP 文件、290 项断言；本地 Vitest 257 项、Deno 261 项、Edge 类型检查和 lint 全部通过。生产 migration 部署后远端 schema lint 为 0 个错误。

## 数据库 RPC 429

使用一个随机临时管理员，通过 service role 仅预填该管理员的 `announcement.write` 固定窗口计数，不创建业务数据。达到 30 次上限后，从真实管理员 JWT 调用公告创建 RPC：

- HTTP 状态：429；
- PostgREST code：`PT429`；
- 结构化等待时间：51 秒；
- 限流测试标题公告行：0。

这证明浏览器可达的数据库写 RPC 会在上限外快速失败，并且失败关闭、不产生公告。

## Edge Function 429 与 Retry-After

同一临时管理员的 `admin.sync.all` 桶仅由 service role 预填至 2 次上限，随后使用真实管理员 JWT 调用生产 `sync-stats` 全体范围入口。限流检查发生在目标加载和任务分发之前，因此本次请求不会创建同步工作：

- HTTP 状态：429；
- `Retry-After` 响应头：596；
- JSON `retryAfterSeconds`：596；
- JSON 错误：`Too many administrative requests`。

响应头和响应体等待秒数一致。

## 生产前端提示

Pages 新版本部署后，在生产 `/admin/announcements` 使用临时管理员完成真实交互：

1. 登录并进入公告管理；
2. 打开“新建公告”对话框；
3. 填写临时标题和正文；
4. 在 service role 将该临时管理员的公告写限额预填满后点击“保存公告”；
5. 页面显示“公告保存失败：操作过于频繁，约 20 秒后可重试。”；
6. 对话框保留标题和正文，便于等待后重试；
7. 页面 console 没有相关 error 或 warning；
8. 数据库确认该标题公告行仍为 0。

## 临时数据清理

烟测结束后，临时管理员先降级为普通成员，再通过目标绑定恢复租约和事务内 Auth 删除 RPC 清理。最终复核：

- 临时 Auth 用户：0；
- 临时 Profile：0；
- 临时管理员限流桶：0；
- 两个限流烟测标题公告：0。
