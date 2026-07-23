# 注册滥用防护代码基础证据（2026-07-23）

日期：2026-07-23（Asia/Shanghai）

## 结论

仓库已具备 Cloudflare Turnstile 客户端 token、Supabase Auth `captchaToken` 透传、
Pages 默认关闭配置门禁和生产就绪检查，但生产尚未启用这些能力。本记录不代表注册
滥用防护已上线，也不授权开启推荐计划或 WebChat 图片输入。

## 已实现

- 注册页仅在 `VITE_REGISTRATION_TURNSTILE_ENABLED=true` 且存在公开 Site Key 时渲染
  Managed Turnstile；验证前不能提交。
- token 只进入一次 `supabase.auth.signUp` 的 `options.captchaToken`，不写入 URL、
  Storage、日志或用户 metadata。注册请求完成、失败、token 过期或 provider error 后
  都清空 token；注册请求不自动重试。
- Pages workflow 校验开关只能为 `true` / `false`，开启时缺少 Site Key 直接终止构建。
- 严格 Supabase 就绪检查要求允许邮箱注册、`mailer_autoconfirm=false`、邮箱 provider
  可用且 `captcha_enabled=true`。这保证浏览器之外的 Auth 直连也必须经过服务端验证。
- 本地 Supabase 明确记录每 IP 的注册/登录与 token 验证基线，并把 CAPTCHA provider
  固定为 Turnstile；本地仍默认关闭且不保存 Secret。
- 启用、回滚、限流和脱敏烟测步骤记录在
  [`docs/registration-abuse-controls.md`](../registration-abuse-controls.md)。

## 当前生产只读观察

通过生产 Supabase 公开 `/auth/v1/settings` 读取到：

| 字段                 | 当前值  |
| -------------------- | ------- |
| `disable_signup`     | `false` |
| `mailer_autoconfirm` | `true`  |
| `captcha_enabled`    | `false` |
| email provider       | `true`  |

因此生产仍会自动确认邮箱，且 Auth 尚未验证 CAPTCHA。新就绪检查在当前状态下失败属于
预期；不得通过放宽检查器、仅隐藏页面或仅配置 Cloudflare WAF 绕过。

## 自动化结果

| 检查                              | 结果                    |
| --------------------------------- | ----------------------- |
| Turnstile / 注册 / 工作流定向测试 | 6 个文件、58 项通过     |
| 完整 Vitest                       | 86 个文件、521 项通过   |
| ESLint                            | 通过，零 warning        |
| TypeScript / Vite 生产构建        | 通过，bundle budget通过 |
| 本地 Supabase 配置解析            | 通过                    |

## 尚未完成

- Cloudflare 尚未创建并配置生产 Managed Widget；仓库 Variables 尚未写入 Site Key 和
  客户端开关。
- Supabase Auth 尚未写入 Turnstile Secret、关闭邮箱自动确认并配置真实邮件确认。
- 生产 Auth 注册、邮件和 token 验证限流尚未记录与验收。
- 无 token、伪 token、有效 token、真实确认邮件、确认前登录拒绝和 `429` 窗口恢复的
  受控生产烟测尚未执行。
- 推荐重开安全闸门已单独部署并保持锁定；推荐计划与图片功能必须继续保持关闭。部署证据见 [`production-referral-reopen-safety-gate-2026-07-23.md`](./production-referral-reopen-safety-gate-2026-07-23.md)。
