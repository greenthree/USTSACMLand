# Auth 限流恢复生产验证 — 2026-08-04

## 结论

本轮没有观察到 HTTP `429`，因此不能把 Auth 限流阈值与窗口恢复记为通过。生产配置已在检查结束后恢复并回读确认，注册、邮箱确认和 Cloudflare Turnstile 均保持开启；没有创建账号，也没有修改成员或业务数据。

## 受控范围

- 在项目负责人授权的短时窗口内，把生产 Auth 登录/注册限额项 `rate_limit_otp` 从 `30` 临时调整为 `2`；
- 使用正式 Chrome 登录页取得彼此独立的一次性 Turnstile token；
- 仅使用不存在的 `.invalid` 邮箱与随机错误密码，不使用真实成员凭据；
- 最终一轮严格限制为 3 次请求，不自动重试、不并发加压，并在首次 `429` 时停止；
- 证据不保存邮箱、密码、验证码 token、API Key、Cookie 或完整认证响应。

## 观察结果

配置降至 `2` 后等待 30 秒，再连续提交 3 次受控登录请求：

| 请求 |  HTTP | `error_code`          | `Retry-After` |
| ---: | ----: | --------------------- | ------------- |
|    1 | `400` | `invalid_credentials` | 无            |
|    2 | `400` | `invalid_credentials` | 无            |
|    3 | `400` | `invalid_credentials` | 无            |

三次请求都通过 CAPTCHA 层并到达标准凭据拒绝路径，但没有触发 `429`。这说明动态降低 `rate_limit_otp` 后，当前公网 IP 已有的令牌桶余额不会立即按新容量收缩；30 秒也不足以证明旧桶已经过期或清空。继续请求只会从受控验证变成生产加压测试，因此按预设上限停止。

## 配置恢复与副作用核对

- 检查后立即把 `rate_limit_otp` 从 `2` 恢复为 `30`，并再次回读确认；
- 生产仍允许邮箱注册，仍要求邮箱确认；
- CAPTCHA 仍启用，provider 仍为 `turnstile`；
- 本轮没有成功认证、没有建立成员会话、没有创建 Auth 用户或 Profile，也没有写入成员平台绑定、统计、训练目标或其他业务数据。

恢复后重新运行 `npm run check:supabase-preflight` 与 `npm run check:supabase-readiness`，两项均通过：生产项目为 `ACTIVE_HEALTHY`，75 个 migration、0 pending、12 个 Edge Function、23 个函数 Secret 名称且 0 缺失，Auth email、匿名 REST、Edge Function 边界和队列调度均为 ready。Supabase 仍未启用 PITR 且没有供应商物理备份，这属于既有备份门禁，不改变本轮 Auth 限流结论。

## 后续方案

剩余发布门禁应在明确的低风险维护窗口完成：让低阈值持续到旧令牌桶自然失效后，再用严格限定次数的请求验证首次 `429` 和窗口恢复；另一种可接受方案是从新的、由维护者控制的公网 IP 发起同样的低次数验证。不得使用代理、伪造转发 IP、请求洪泛或真实成员凭据制造结果。
