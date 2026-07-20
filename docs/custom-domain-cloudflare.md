# `ustsacm.fun` 自定义域名运行手册

USTSACMLand 继续由 GitHub Pages 托管静态文件，Cloudflare 负责权威 DNS、CDN、TLS 和缓存。Cloudflare Pages 不参与当前生产部署。

## DNS 与 GitHub Pages

1. 阿里云注册商保持 Cloudflare 分配的两条 NS，不在阿里云 DNS 控制台重复添加解析记录。
2. Cloudflare DNS 创建 `CNAME @ -> greenthree.github.io`，接入阶段先设为 DNS only（灰云）。Cloudflare 会对根域执行 CNAME Flattening。
3. 可选创建 `CNAME www -> ustsacm.fun`；正式入口仍为裸域 `https://ustsacm.fun/`。
4. GitHub 仓库 Settings → Pages → Custom domain 填写 `ustsacm.fun`。使用 GitHub Actions 发布时不依赖仓库内 `CNAME` 文件。
5. 在 GitHub 个人 Settings → Pages 验证 `ustsacm.fun`，将 GitHub 提供的 `_github-pages-challenge-greenthree` TXT 记录永久保留在 Cloudflare，防止 Pages 域名接管。
6. 等待 GitHub 显示 DNS check successful 并签发证书，然后开启 Enforce HTTPS。
7. HTTPS 正常后把 Cloudflare 根域记录切换为 Proxied（橙云），SSL/TLS 模式设为 Full (strict)。禁止使用 Flexible。

## Cloudflare 缓存

- 不启用全站 Cache Everything。
- `/assets/*` 是带内容哈希的构建资源，可设置 Edge TTL 一年、Browser TTL 一年。
- `/`、`index.html`、`404.html` 和 SPA 路由不设置长期缓存；发布后如页面未更新，清理对应 HTML 或执行一次 Purge Everything。
- 不缓存 Supabase API、认证或 WebChat 响应；这些请求不经过 `ustsacm.fun` 静态源站。

## Supabase

- Auth Site URL：`https://ustsacm.fun/`
- Redirect URLs：至少包含 `https://ustsacm.fun/**`，迁移期保留 localhost 与 `https://greenthree.github.io/USTSACMLand/**`。
- `ALLOWED_ORIGIN`：加入 `https://ustsacm.fun`。
- `CHAT_ALLOWED_ORIGINS`：加入 `https://ustsacm.fun`。
- Origin 只有协议和主机名，不包含尾部路径。

## 验收

依次验证：首页、`/rankings` 深链刷新、登录、注册、真实邮箱找回密码、账号页、AI 助手、个人数据导出和管理员后台。最后确认 `https://greenthree.github.io/USTSACMLand/` 自动跳转到正式域名，GitHub Pages 发布后的生产榜单审计也以 `https://ustsacm.fun/` 为目标。

## 回滚

1. Cloudflare 将根域记录切回 DNS only，排除代理或缓存问题。
2. 必要时暂时删除 GitHub Pages Custom domain，使默认 `github.io` 地址恢复为源站入口。
3. 回退到上一个通过 CI 的提交并重新触发 Pages 发布。
4. 恢复自定义域名时重新完成 DNS check、证书签发、Enforce HTTPS，再开启橙云代理。
