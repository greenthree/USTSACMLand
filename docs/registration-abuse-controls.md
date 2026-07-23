# 注册滥用防护

USTSACMLand 的注册入口直接使用 Supabase Auth。验证码必须同时由浏览器取得 token、
由 Supabase Auth 使用私有 Secret 验证；只在页面隐藏按钮、只配置 Cloudflare WAF，或
只检查前端字段都无法阻止攻击者直接调用 Auth 注册接口。

## 配置边界

- `VITE_TURNSTILE_SITE_KEY` 是公开站点 Key，只能放在 GitHub Actions Variable。
- Turnstile Secret 只写入 Supabase Dashboard 的 Auth CAPTCHA 配置，不能使用
  `VITE_*` 名称、GitHub Pages Secret、数据库表或前端代码保存。
- `VITE_REGISTRATION_TURNSTILE_ENABLED` 默认 `false`。开启后缺少站点 Key 时构建失败，
  浏览器运行时配置异常时注册按钮失败关闭。
- 推荐计划、WebChat 图片输入和图片清理任务有独立开关。完成验证码配置不会自动开启
  这些功能。

## 生产启用顺序

跨 Cloudflare、Supabase 和 GitHub Pages 的配置不是单一事务。为了避免部署窗口内出现
无验证码注册或所有注册意外失败，启用时先在 Supabase Auth 暂时禁止新用户注册：

1. 在 Cloudflare Turnstile 创建 Managed Widget，允许 `ustsacm.fun` 和
   `www.ustsacm.fun`，记录 Site Key 与 Secret Key。
2. 在 Supabase Auth 打开真实邮箱确认，确认 `mailer_autoconfirm=false`；检查正式域名、
   localhost 和旧 GitHub Pages 地址仍在允许的重定向列表中。
3. 在 Supabase Auth 选择 Turnstile，写入 Secret Key 并启用 CAPTCHA。不要把 Secret
   写进仓库或 GitHub Pages 构建变量。
4. 在 Supabase Auth 配置并记录 `sign_in_sign_ups`、邮件发送和
   `token_verifications` 限额。校园网络可能共享公网 IP，阈值需要兼顾正常集中注册，
   但不能保持未记录的平台默认值。
5. 在 GitHub 仓库 Actions Variables 写入
   `VITE_REGISTRATION_TURNSTILE_ENABLED=true` 与公开的
   `VITE_TURNSTILE_SITE_KEY`，完成 Pages 构建和部署。
6. 保持推荐计划和图片三层开关关闭，重新允许 Auth 新用户注册，立即执行下述烟测。

## 必须烟测

- 不带 `captchaToken` 和使用伪造 token 直接请求 Supabase Auth 均被拒绝，且没有创建
  `auth.users`、Profile、默认 WebChat 额度或 XCPC 占位数据。
- 页面完成 Turnstile 后仅发起一次注册；token 过期、provider error 或注册失败后必须
  清空并重新验证，不能自动重试注册。
- 有效注册不会立即建立登录会话，而是发送真实确认邮件；确认前不能登录、不能获得推荐
  奖励，首次确认只处理一次。
- 推荐计划关闭、读取失败和页面初始加载期间，普通用户看不到邀请码、推荐计划名称或历史
  奖励；带 `?invite=` 的链接也不能绕过关闭状态。
- 同一 IP 的受控 burst 在记录的阈值处返回 `429`，窗口恢复后正常注册；日志和证据不得
  保存邮箱、密码、验证码 token 或 Turnstile Secret。

严格检查 `npm run check:supabase-readiness` 要求生产同时满足：允许邮箱注册、关闭邮箱
自动确认、启用邮箱 provider、启用服务端 CAPTCHA。生产配置完成前该检查失败属于预期，
不得通过放宽检查器绕过。
