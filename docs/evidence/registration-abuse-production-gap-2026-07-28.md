# 注册滥用防护生产配置进展 — 2026-07-28

## 结论

Cloudflare Turnstile、Supabase 服务端 CAPTCHA、真实邮箱确认、Auth 限流和 GitHub Pages 客户端门禁已经配置并部署。无 token 与伪造 token 的直连注册均被生产 Supabase Auth 拒绝，严格就绪检查通过。

推荐计划和 WebChat 图片功能继续关闭。完整发布验收仍缺“全新真实邮箱 + 有效 Turnstile token”的确认邮件、确认前登录拒绝、重复确认幂等和受控 `429` 恢复烟测，因此相关 ROADMAP 条目暂不勾选。

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

校园网络可能共享公网 IP，后续 `429` 烟测应使用受控窗口，不能为了测试长期降低生产阈值。

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

两项检查均通过，结果为 71 个 migration、0 pending、10 个 Edge Function、21 个函数 Secret 名称且 0 缺失、0 schema lint，Auth email、匿名 REST、函数边界和队列调度均为 ready。Supabase 仍无 PITR/供应商物理备份，继续依赖已演练的加密逻辑备份。

## 剩余发布证据

1. 使用一个尚未注册且可接收邮件的真实邮箱完成 Turnstile 注册；
2. 验证注册响应不立即创建会话，确认前登录失败；
3. 打开确认邮件并验证首次确认生效、重复确认不重复发奖；
4. 在不污染成员数据的受控窗口验证 `429` 阈值与窗口恢复；
5. 完成后更新发布门禁并决定是否解除推荐计划安全暂停；WebChat 图片仍需自身开放态验收。

详细操作与失败关闭要求见 [`docs/registration-abuse-controls.md`](../registration-abuse-controls.md)。
