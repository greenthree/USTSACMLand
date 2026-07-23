# 推荐计划生产重开安全闸门证据（2026-07-23）

日期：2026-07-23（Asia/Shanghai）

## 结论

`202607230003_referral_reopen_safety_gate.sql` 已单独部署到生产。推荐计划继续保持全局
关闭；浏览器管理员即使调用既有开启 RPC，也会被私有表上的触发器拒绝，除非维护者先在
受控数据库操作中明确解锁 `reopen_allowed`。

本次没有部署 WebChat 图片 migration、图片 Edge Function 或任何图片生产开关。

## 隔离部署

为避免 `supabase db push` 顺带应用同日期的图片 migration，部署使用独立临时 workdir：

- 保留全部已部署 migration。
- 保留待部署的 `202607230003_referral_reopen_safety_gate.sql`。
- 明确排除 `202607230001_webchat_image_attachments.sql`。
- 明确排除 `202607230004_webchat_image_global_limits.sql`。

远端 dry-run 精确输出：

```text
Would push these migrations:
 • 202607230003_referral_reopen_safety_gate.sql
```

实际 push 随后只应用同一个 migration。部署后 `migration list --linked` 显示：

| Migration      | 生产状态 |
| -------------- | -------- |
| `202607230001` | pending  |
| `202607230002` | applied  |
| `202607230003` | applied  |
| `202607230004` | pending  |

## 失败关闭验证

迁移在创建触发器后，会在嵌套事务中尝试把单例配置从关闭改为开启。只有触发器返回预期的
SQLSTATE `55000` 时迁移才能继续提交；若更新成功、配置不是关闭态或安全闸门未锁定，
迁移本身会失败。生产迁移成功提交，因此该真实重开拒绝路径已经在部署事务内执行。

部署后使用匿名 key 调用公开 `check_referral_code(null)`，返回：

```json
{ "program_enabled": false, "available": false }
```

这同时证明普通用户仍看不到可用的邀请码状态。数据库触发器是最终写入边界，前端隐藏不
作为安全证据。

## 自动化与边界

- 本地实际重复应用 003 migration 成功，迁移内自检通过。
- 推荐计划 pgTAP 文件 40、41、43、44：4 个文件、92 项断言全部通过。
- 本地全套 45 个数据库文件中，推荐计划相关文件均通过；第 42 个图片测试因日常本地库
  曾应用旧版 pending 图片 migration 而有 1 项已知失配。独立干净数据库安装当前完整
  migration 链的 1149/1149 结果记录在
  [`webchat-image-safety-foundation-2026-07-23.md`](./webchat-image-safety-foundation-2026-07-23.md)。

## 仍未授权重开

生产 Auth 仍为 `mailer_autoconfirm=true` 且 `captcha_enabled=false`。安全闸门虽然已
部署，但 `reopen_allowed` 必须继续为 `false`；完成真实邮箱确认、Turnstile、Auth
限流、批量注册防护和真实并发烟测前，不得重新开放推荐计划。
