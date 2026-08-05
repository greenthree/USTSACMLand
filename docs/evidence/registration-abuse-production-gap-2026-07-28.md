# 注册滥用防护生产配置进展 — 2026-07-28

## 结论

Cloudflare Turnstile、Supabase 服务端 CAPTCHA、真实邮箱确认、Auth 限流和 GitHub Pages 客户端门禁已经配置并部署。无 token 与伪造 token 的直连注册均被生产 Supabase Auth 拒绝，严格就绪检查通过。2026-07-29 又使用可接收邮件的全新地址完成有效 Turnstile 注册、确认前登录拒绝、真实邮件确认、确认链接重复打开和确认后密码登录烟测。

推荐计划和 WebChat 图片功能继续关闭。本轮临时账号已经通过正式自助注销完成清理，并对 Auth、Profile 和关联数据做了零行复核。完整发布验收仍缺可复现的受控 `429` 阈值/窗口恢复证据；限流操作可能短暂影响同一公网 IP 下的正常认证，执行前必须取得项目负责人确认并选择低风险窗口。

## 已完成配置

### Cloudflare Turnstile

- 创建 Managed Widget：`USTSACMLand 注册防护`；
- 正式客户端使用公开 Site Key，私有 Secret 未写入仓库、GitHub、数据库、文档或聊天；
- Widget 允许 `ustsacm.fun`。`www.ustsacm.fun` 在应用加载前重定向到主域名，因此 Turnstile 实际执行主机名仍为 `ustsacm.fun`；
- 预清除保持关闭。

### Supabase Auth

生产实际状态：

- 允许邮箱注册；
- `mailer_autoconfirm=false`，首次登录前必须确认邮箱；
- 邮箱 provider 已启用；
- CAPTCHA provider 为 Cloudflare Turnstile，服务端 Secret 已配置；
- 推荐计划与 WebChat 图片功能的独立开关未开启。

控制台首次保存 CAPTCHA 连续返回 `500`。随后使用 Supabase 官方 CLI 配置接口提交 Auth 配置；Secret 仅从已登录 Cloudflare 页面进入进程内存，CLI 输出只显示哈希，不保存明文。提交后 Auth 公共端点确认注册与邮箱确认状态已实际生效。

### Auth 限流

- 邮件发送：2 封/小时（Free 项目控制台锁定）；
- token 验证：30 次/5 分钟/IP；
- 注册与登录：30 次/5 分钟/IP。

校园网络可能共享公网 IP，后续 `429` 烟测应使用受控窗口，不能为了测试长期降低生产阈值。控制台把注册与登录限制实现为令牌桶：30 次是突发容量，同时按 360 次/小时补充，并非“任意五分钟内第 31 次必定失败”的固定窗口。

### GitHub Pages

仓库 Actions Variables 已配置：

- `VITE_REGISTRATION_TURNSTILE_ENABLED=true`；
- `VITE_TURNSTILE_SITE_KEY` 为公开 Site Key。

重跑主分支 CI `30333025157`（attempt 2）成功，随后 Pages 部署 `30336988068` 成功。生产 `/register` 已显示 Cloudflare Turnstile，验证完成前注册按钮保持禁用。

## 已完成烟测

直接请求生产 `/auth/v1/signup`：

| 场景               | HTTP | error_code       | 结果       |
| ------------------ | ---: | ---------------- | ---------- |
| 不带 CAPTCHA token |  400 | `captcha_failed` | 未创建账号 |
| 伪造 token         |  400 | `captcha_failed` | 未创建账号 |

新版 `/auth/v1/settings` 不再返回 `captcha_enabled`。就绪检查器已改为使用“格式无效邮箱 + 无 token”的无副作用探针：启用 CAPTCHA 时先返回 `captcha_failed`；未启用时只会返回邮箱格式错误，不会创建用户。对应单元测试 20 项通过。

```powershell
npm run check:supabase-preflight
npm run check:supabase-readiness
```

2026-07-29 重新运行两项检查均通过，结果为 71 个 migration、0 pending、10 个 Edge Function、23 个函数 Secret 名称且 0 缺失、0 schema lint，Auth email、匿名 REST、函数边界和队列调度均为 ready。Supabase 仍无 PITR/供应商物理备份，继续依赖已演练的加密逻辑备份。

## 剩余发布证据

1. 在不污染成员数据且不影响正常成员认证的受控窗口验证 `429` 阈值与窗口恢复；
2. 完成后更新发布门禁。推荐计划和 WebChat 图片功能继续保持关闭，不因注册防护通过而恢复开发或开放。

详细操作与失败关闭要求见 [`docs/registration-abuse-controls.md`](../registration-abuse-controls.md)。

## 2026-07-29 受控限流与清理检查

项目负责人确认低风险窗口后执行了两组各不超过 30 次的脱敏检查：

1. 通过正式登录页逐次等待新的 Managed Turnstile token，再提交不存在账号的错误凭据；请求分布期间令牌桶持续补充，全部返回标准凭据拒绝，没有出现 `429`；
2. 等待窗口后取得一个新的 Managed Turnstile token，对同一不存在账号快速逐次请求并在首次 `429` 时停止。第一次请求消费 token 后，后续请求在 CAPTCHA 层返回 `400`，30 次上限内仍未到达 Auth 登录限流器。

因此本轮只证明生产 CAPTCHA 失败关闭、正常凭据拒绝和 30 次安全上限，不把它记作 `429` 恢复通过，也没有为制造结果而降低生产阈值或继续加压。Supabase 控制台再次确认当前登录/注册突发容量为 30 次/5 分钟、等效补充速率为 360 次/小时。

本轮临时普通成员已经确认邮箱并完成密码登录。随后尝试从 Supabase Dashboard 直接删除时，数据库事务删除围栏按设计拒绝了未经过恢复下限租约的 Auth 删除；账号与 Profile 保持一致，没有出现半删除。邮件窗口恢复后通过正式密码恢复重新取得账号控制权，没有使用临时后门绕过。

## 2026-07-29 真实邮件注册烟测

本轮通过正式域名的真实注册、登录和邮件页面执行以下流程，证据不记录邮箱、密码、Turnstile token、确认 token、用户 UUID 或完整认证响应：

1. Managed Turnstile 完成前注册按钮保持禁用；完成后使用全新可收件地址提交注册；
2. 注册响应不建立登录会话，并提示需要邮箱确认；
3. 使用同一密码在确认前登录，生产 Auth 返回 `Email not confirmed`；
4. 收到 Supabase Auth 的真实确认邮件，打开确认链接后正式站点建立成员会话；
5. 再次打开已消费的一次性确认链接时 Supabase 返回标准 `otp_expired`，既有账号和会话不受破坏；退出后使用密码重新登录并正常进入 `/account`；
6. 推荐计划保持关闭，注册页没有邀请码或奖励信息；全程没有开启 WebChat、图片输入或推荐计划。

生产控制台没有阻断认证的应用错误。确认链接建立会话时观察到一条 Supabase 客户端时钟偏差 warning，随后密码登录和账号页均正常；该 warning 不包含凭据或成员信息，后续发布观察继续留意主机时钟同步。

## 2026-07-29 自助注销修复与清理

生产启用全局 Turnstile 后，`change-password` 与 `delete-account` 最初仍在 Edge Function 内直接调用 `signInWithPassword` 复核当前密码，却没有传入 CAPTCHA token。相同密码可以在正式登录页成功，但服务端复核会被 Auth CAPTCHA 拒绝，并被旧逻辑误映射为“当前密码错误”。

本轮修复为修改密码和注销分别增加独立、一次性的 Turnstile token：

1. 两个操作使用彼此隔离的控件和 reset key，token 未就绪时提交按钮保持禁用；
2. 每次成功、远端失败或本地校验失败后立即清空 token 并重置控件；
3. AuthContext 把 token 放入 Edge Function 请求体；请求解析拒绝缺失、空白和超长 token；
4. Edge Function 使用 `signInWithPassword({ email, password, options: { captchaToken } })` 复核密码；
5. `change-password` 与 `delete-account` 已部署，前端经 PR #132 合并并由 GitHub Pages 成功发布。

正式域名烟测中，注销确认区显示独立安全验证，完成验证、输入密码并明确确认后只提交一次注销请求。恢复下限记录和事务删除完成后页面跳转到登录页；使用同一邮箱和密码重新登录返回标准 `Invalid login credentials`。

随后在 Supabase SQL Editor 使用脱敏用户 ID 运行只读聚合查询，以下项目均为 0：Auth 用户、Profile、平台绑定、同步任务与运行、平台统计与快照、每日一题完成和评论、训练目标、管理员限流桶、WebChat 访问/额度/日用量/请求/会话、图片上传状态与附件、推荐码与绑定、审计日志。旧 JWT 对 REST 的只读查询也统一返回 `401`，确认会话已失效。查询和文档均未记录邮箱、密码、JWT、Turnstile token、确认 token或用户 UUID。

## 2026-08-04 动态降阈值验证

项目负责人再次授权受控生产检查后，将 Auth 登录/注册限额项 `rate_limit_otp` 临时从 `30` 降至 `2`。使用正式 Chrome 登录页取得独立的一次性 Turnstile token，等待 30 秒后对不存在的 `.invalid` 邮箱和随机错误密码最多提交 3 次；三次均返回 HTTP `400` / `invalid_credentials`，没有 `Retry-After`，也没有触发 `429`。

本轮说明 Supabase 动态降低配置不会立即收缩当前公网 IP 已有的令牌桶余额，30 秒也不足以清空旧桶。为避免把烟测升级为生产加压测试，请求达到预设上限后立即停止，并把配置恢复为 `30`；回读确认注册、邮箱确认和 Turnstile 均保持开启。没有创建账号、建立成员会话或修改任何成员数据。

因此 `429` 阈值与窗口恢复仍是未完成发布门禁。后续只能在明确维护窗口让低阈值持续到旧桶自然失效，或从新的受控公网 IP 进行同样的低次数验证；不得使用代理、伪造转发 IP或请求洪泛。完整证据见 [`auth-rate-limit-recovery-production-2026-08-04.md`](./auth-rate-limit-recovery-production-2026-08-04.md)。
