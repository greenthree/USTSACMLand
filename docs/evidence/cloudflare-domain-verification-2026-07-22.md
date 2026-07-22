# Cloudflare 正式域名核对 — 2026-07-22

## 范围

本次只读核对正式域名、`www`、旧 GitHub Pages 地址、HTTP 到 HTTPS 跳转、SPA 深链和缓存响应头，不修改 Cloudflare 或 GitHub 配置。

## 已确认

- `ustsacm.fun` 与 `www.ustsacm.fun` 均解析到 Cloudflare 边缘地址。
- `http://ustsacm.fun/` 返回 `301`，目标为 `https://ustsacm.fun/`。
- `http://www.ustsacm.fun/` 和 `https://www.ustsacm.fun/` 均返回 `301`，目标为 `https://ustsacm.fun/`。
- `https://greenthree.github.io/USTSACMLand/` 返回 `301`，目标为 `https://ustsacm.fun/`。
- `https://ustsacm.fun/` 由 Cloudflare 提供，返回 `200`；HTML 的浏览器缓存为 10 分钟。
- 指纹 JavaScript 资源返回 `200`，浏览器缓存为 4 小时。
- 直接访问 `https://ustsacm.fun/assistant` 时，GitHub Pages 返回 SPA `404.html`，HTTP 状态仍为 `404`；真实浏览器能够加载同一 React bundle，并正确进入带 `returnTo` 语义的登录页面。

## 尚未完成

- 指纹静态资源目前只有 4 小时浏览器缓存，尚未验证 Cloudflare 是否配置一年期 `immutable` 缓存规则。
- 尚未逐项验证正式域名下的真实登录、邮箱找回、账号页、AI 助手、个人数据导出和管理员入口。
- 尚未执行 Cloudflare 缓存清理、证书异常和 DNS 回滚演练。
- GitHub Pages 的 SPA fallback 会返回 HTTP `404`；页面对浏览器可用，但监控、搜索引擎或只接受 `2xx` 的客户端会把深链判定为失败。若要让深链同时返回 `200`，需要在 Cloudflare 层增加 URL 重写/Worker，或迁移到支持 SPA fallback 的托管方式。

因此 `ROADMAP.md` 中 Cloudflare 的复合验收项继续保持未完成。
