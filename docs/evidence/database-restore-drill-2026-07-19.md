# 生产加密数据库隔离恢复演练证据（2026-07-19）

## 范围

- 正式备份提交：`71a1f29c06dc2e26d1553798a49e7784e2101b7c`
- 正式备份运行：[`29655510350`](https://github.com/greenthree/USTSACMLand/actions/runs/29655510350)
- 加密备份 Artifact：`ustsacmland-database-backup-29655510350-1`
- 加密备份 Artifact ID：`8432766009`
- 加密备份 Artifact 大小：204,746 字节
- 最终恢复演练提交：`8a093752e602d6e4ae51df7d5d112aeace0488a0`
- 最终恢复演练运行：[`29656219433`](https://github.com/greenthree/USTSACMLand/actions/runs/29656219433)
- 脱敏报告 Artifact：`database-restore-drill-29656219433`
- 脱敏报告 Artifact ID：`8432962881`
- 两个 Artifact 均按工作流保留 14 天。

本文只记录聚合行数、布尔验收结果、运行标识和耗时，不记录姓名、邮箱、QQ、平台账号、密码哈希、消息正文、SQL、数据库连接、Token 或加密口令。

## 备份格式验证

正式 `main` 备份完成以下步骤：

1. 使用固定版本 Supabase CLI 和短期数据库登录导出角色、应用 Schema、`public/private` 业务数据、Auth 数据及 migration 历史；
2. 从同次临时 Auth Schema dump 中精确提取挂在 `auth.users` 上的三个本站触发器，完整 Auth Schema 未进入归档；
3. 在密文内生成 7 项聚合恢复清单和全部明文成员的 SHA-256；
4. 使用 AES-256-CBC、PBKDF2-SHA256、600,000 次迭代加密并立即完成自解密校验；
5. 删除临时 Auth Schema、SQL 和明文压缩包，只上传密文及密文 SHA-256。

最终 Artifact 来源为 `main` 的成功 `workflow_dispatch`，run attempt 为 1，未过期；恢复工作流对仓库、工作流路径、分支、提交、结论、Artifact 名称和恢复下限完成了独立校验。

## 隔离恢复结果

恢复工作流没有 Supabase Access Token、项目引用或远端数据库连接。它将仓库 migration 暂时移出目标目录，只在 GitHub Runner 的一次性本地 Supabase/PostgreSQL 17 中，通过容器内 `supabase_admin` Unix socket 执行单事务恢复；任务结束后无状态销毁本地服务。

脱敏报告中的 7 项恢复行数与密文内清单完全一致：

| 项目           | 恢复行数 |
| -------------- | -------: |
| Profiles       |        7 |
| 平台账号       |       37 |
| 当前平台统计   |       36 |
| 统计快照       |      336 |
| 同步运行       |      471 |
| Auth 用户      |        7 |
| Migration 历史 |       51 |

四类关系孤儿均为 0：

- Profile 无 Auth 用户：0
- 平台账号无 Profile：0
- 平台统计无 Profile：0
- 平台统计无对应平台账号：0

## Auth、RLS 与清理

最终报告确认：

- 三个 `auth.users` 应用触发器均已恢复；
- 随机临时账号由 Auth Admin 创建，注册触发器自动创建本人 Profile；
- 临时账号可以使用随机密码登录；
- 登录账号只能读取自己的 Profile，不能读取其他成员的私有 Profile；
- 匿名用户可以读取公开成员视图；
- 匿名私表请求被拒绝或得到严格的 RLS 空数组，不可见任何行；
- 临时账号通过目标绑定恢复租约和受控注销 RPC 删除，未绕过注销围栏；
- Auth 与 Profile 均无临时账号残留；
- 本地 Supabase、解密文件、临时密码、请求和响应在报告上传前清理完成；上传物只有脱敏 JSON。

## 耗时与恢复边界

- GitHub Actions 端到端演练：2 分 7 秒。
- 单事务恢复、聚合核对、Auth/RLS 与清理验证阶段：3 秒。

因此数据库逻辑恢复的当前自动化 RTO 基线为约 3 分钟。该值只覆盖受控 Runner 中的数据库恢复和基本 Auth/RLS 验证，不覆盖新建远端 Supabase 项目、重新配置 Function Secrets/Auth 回调、部署 Edge Functions、切换 DNS、第三方凭据恢复或业务负责人复核；完整站点事故恢复 RTO 仍须在远端灾备演练后确认。

## 诊断记录

正式成功前的失败任务均在一次性本地环境中失败关闭，生产未被写入，且失败时没有上传报告：

- 早期演练暴露普通数据库角色不能清理或接管平台 Auth 对象；恢复入口随后固定为容器内 `supabase_admin` Unix socket。
- 旧备份没有保存挂在 `auth.users` 上的跨 Schema 应用触发器，导致恢复后注册不能自动建档；备份格式增加了精确允许名单的 `auth-hooks.sql`。
- 最后两次失败位于临时账号删除后的只读残留查询，分别暴露 `psql` 变量替换和错误限定 `COALESCE` 的语法问题；受控注销 RPC 本身已成功，修正查询后最终 `main` 演练通过。

这些失败没有被自动重试或用宽松断言掩盖，每次都先根据固定脱敏阶段标记定位并通过 PR 门禁修复。

## 结论

当前真实加密逻辑备份已证明可以在干净的 Supabase 平台基线中恢复角色、应用 Schema、Auth hooks、业务/Auth 数据和 migration 历史，并支持密码登录、Profile RLS、匿名边界和受控注销。发布检查单中的首次隔离恢复演练项可以标记完成。

监控/告警/备份综合 ROADMAP 项仍保持未完成：生产同步失败告警 Secrets、真实告警投递烟测和完整受控注销外部恢复下限流程尚未全部验收。
