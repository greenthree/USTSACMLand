# Cloudflare 正式域名核对 — 2026-07-22

## 范围

2026-07-22 首次只读核对正式域名、`www`、旧 GitHub Pages 地址、HTTP 到 HTTPS 跳转、SPA 深链和缓存响应头；2026-07-28 经项目负责人明确确认后补充执行两条 Cloudflare 缓存生产配置，过程和复验结果记录在文末。

## 已确认

- `ustsacm.fun` 与 `www.ustsacm.fun` 均解析到 Cloudflare 边缘地址。
- `http://ustsacm.fun/` 返回 `301`，目标为 `https://ustsacm.fun/`。
- `http://www.ustsacm.fun/` 和 `https://www.ustsacm.fun/` 均返回 `301`，目标为 `https://ustsacm.fun/`。
- `https://greenthree.github.io/USTSACMLand/` 返回 `301`，目标为 `https://ustsacm.fun/`。
- `https://ustsacm.fun/` 由 Cloudflare 提供，返回 `200`；HTML 的浏览器缓存为 10 分钟。
- 指纹 JavaScript 资源返回 `200`；2026-07-22 初始浏览器缓存为 4 小时，2026-07-28 已提升为一年并增加 `immutable`。
- 直接访问 `https://ustsacm.fun/assistant` 时，GitHub Pages 返回 SPA `404.html`，HTTP 状态仍为 `404`；真实浏览器能够加载同一 React bundle，并正确进入带 `returnTo` 语义的登录页面。

## 尚未完成

- 尚未逐项验证正式域名下的真实登录、邮箱找回、账号页、AI 助手、个人数据导出和管理员入口。
- 尚未执行 Cloudflare 缓存清理、证书异常和 DNS 回滚演练。
- GitHub Pages 的 SPA fallback 会返回 HTTP `404`；页面对浏览器可用，但监控、搜索引擎或只接受 `2xx` 的客户端会把深链判定为失败。若要让深链同时返回 `200`，需要在 Cloudflare 层增加 URL 重写/Worker，或迁移到支持 SPA fallback 的托管方式。

因此该条目在 2026-07-22 首次核对时保持未完成；后续长期缓存完成情况见文末补充。

## 2026-07-26 登录态补充核对

使用项目负责人已登录的真实生产管理员会话，在 `https://ustsacm.fun` 只读核对：

- `/account` 完成会话恢复并显示本人资料、六个平台绑定状态、个人数据导出入口、修改密码入口和管理员注销保护；
- `/assistant` 完成权限检查并显示当前模型、真实累计额度、私有历史会话和输入工作台；本轮没有发送消息或消耗额度；
- `/admin` 完成管理员权限检查，显示后台导航、同步概览和推荐计划全局状态；
- 推荐计划当前为全线关闭。打开“开启推荐计划”确认界面后，页面要求填写变更原因并勾选全站影响确认，确认按钮默认禁用；随后取消并确认对话框消失，没有提交配置变更。

本轮没有下载个人数据文件、修改账号资料、切换推荐计划或写入生产数据。首页、SPA 深链、账号页、AI 助手和后台入口已有生产证据；真实邮箱找回密码已有独立生产证据。Cloudflare 复合条目仍缺缓存清理、证书/DNS 回滚和静态资源长期缓存配置，因此继续保持未完成。

## 2026-07-28 缓存门禁补充核对

仓库新增可复跑的只读门禁：

```powershell
npm run check:cloudflare-domain
```

门禁覆盖裸域 HTTP、`www` 和旧 GitHub Pages 地址跳转，首页、`index.html`、`404.html` 与 `/rankings` 深链的 SPA 文档和短缓存，以及首页实际引用的指纹 JavaScript 资源。连续两次读取当前生产资源后得到：

```json
{
  "htmlMaxAge": 600,
  "assetMaxAge": 14400,
  "assetCacheStatus": "HIT"
}
```

域名、跳转、SPA 文档、HTML 十分钟缓存和 Cloudflare 边缘命中均符合预期；当时指纹资源仍因浏览器缓存只有 4 小时且响应头缺少 `immutable` 而被门禁拒绝。

## 2026-07-28 长期缓存生产配置

经项目负责人明确确认后，在 Cloudflare 控制台为同一匹配范围

```text
(http.host eq "ustsacm.fun" and starts_with(http.request.uri.path, "/assets/"))
```

部署并确认两条活动规则：

- `指纹静态资源长期缓存`：响应符合缓存条件，忽略源站缓存控制标头，Edge TTL 与 Browser TTL 均为一年；
- `指纹静态资源 Cache-Control`：向浏览器可见的响应添加 `public`、`max-age=31536000` 与 `immutable` 指令，三项均未设置为“仅 Cloudflare”。

部署后立即重新运行同一只读门禁，首次复验即通过：

```json
{
  "origin": "https://ustsacm.fun",
  "assetPath": "/assets/index-Co-RLMAi.js",
  "htmlMaxAge": 600,
  "assetMaxAge": 31536000,
  "assetCacheStatus": "HIT",
  "cfRay": "a2218d0439d6fe9f-AMS"
}
```

因此域名跳转、SPA fallback、HTML 短缓存、指纹资源一年浏览器缓存、`immutable` 和二次边缘命中均已通过自动门禁，`ROADMAP.md` 中对应 Cloudflare TLS、HTTPS 与缓存规则条目可以标记为完成。缓存清理、证书异常和 DNS 回滚演练仍属于后续复合运维验收，不由本条缓存配置替代。
