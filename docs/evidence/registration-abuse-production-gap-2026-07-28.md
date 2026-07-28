# 注册滥用防护生产配置缺口 — 2026-07-28

## 结论

客户端、构建门禁和 Supabase 就绪检查已经具备，但生产 Turnstile 与真实邮箱确认尚未配置，当前不能安全开启推荐计划或 WebChat 图片输入。

## 只读证据

### Supabase Auth

`npm run check:supabase-preflight` 确认项目、71 个 migration、10 个 Edge Function、21 个函数 Secret、匿名 REST、函数边界和队列调度均正常，同时返回：

- `mailer_autoconfirm=true`：注册后自动确认邮箱；
- `captcha_enabled=false`：服务端不要求 CAPTCHA。

因此攻击者仍可绕过网页，直接调用 Supabase Auth 注册接口。

### Cloudflare Turnstile

使用已登录的 Cloudflare 控制台只读打开账户 Turnstile 页面。页面只显示“手动添加小部件”和“使用 Spin 设置”，没有任何已有 Widget 列表或可复用 Site Key；本轮没有点击创建按钮或修改配置。

### GitHub Pages 构建变量

```powershell
gh variable list --repo greenthree/USTSACMLand --json name,updatedAt
gh secret list --repo greenthree/USTSACMLand --json name,updatedAt
```

仅核对名称和更新时间，不读取 Secret 值。当前仓库没有：

- `VITE_REGISTRATION_TURNSTILE_ENABLED`；
- `VITE_TURNSTILE_SITE_KEY`。

代码和部署工作流会在变量缺失时保持 Turnstile 默认关闭；即使前端变量开启，Turnstile Secret 也必须只配置到 Supabase Auth CAPTCHA，不能写入 GitHub 或前端。

## 后续生产顺序

1. 在切换窗口内临时禁止 Auth 新用户注册；
2. 创建 Cloudflare Managed Turnstile Widget，允许 `ustsacm.fun` 与 `www.ustsacm.fun`；
3. 在 Supabase Auth 关闭邮箱自动确认、启用真实确认邮件；
4. 在 Supabase Auth 选择 Turnstile、写入私有 Secret 并启用 CAPTCHA；
5. 配置并记录 Auth 注册、邮件和 token 验证限流；
6. 写入两个 GitHub Actions Variables，部署 Pages；
7. 恢复注册，执行无 token、伪 token、有效 token、邮件确认、重复确认和 `429` 恢复烟测；
8. 重跑 `npm run check:supabase-readiness`，只有严格门禁通过后才能解除相关安全暂停。

详细操作与失败关闭要求见 [`docs/registration-abuse-controls.md`](../registration-abuse-controls.md)。
