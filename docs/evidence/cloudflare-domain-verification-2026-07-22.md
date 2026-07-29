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

## 2026-07-29 缓存清理与 TLS / DNS 基线复验

使用已登录的 Cloudflare 控制台执行一次受控的按 URL 清理，仅清除以下 SPA 文档缓存，没有清除 `/assets/*` 指纹资源：

```text
https://ustsacm.fun/
https://ustsacm.fun/index.html
https://ustsacm.fun/404.html
https://ustsacm.fun/rankings
```

Cloudflare 明确返回“已成功收到清除请求，并将在 5 秒内生效”。清理生效后重新请求首页两次，均返回 `200`、`Cache-Control: max-age=600`；HTML 当前按 Cloudflare 策略显示为 `CF-Cache-Status: DYNAMIC`。随后重新运行：

```powershell
npm run check:cloudflare-domain
```

门禁再次通过，首页引用的当前指纹资源为 `/assets/index-D-zgxtCR.js`，Browser TTL 仍为一年、包含 `immutable`，第二次读取为 `CF-Cache-Status: HIT`。这证明受控清理不会破坏正式域名、跳转、SPA 文档和长期指纹资源缓存契约。

同一轮只读复验确认：

- `ustsacm.fun` 为指向 `greenthree.github.io` 的已代理 CNAME；
- `www.ustsacm.fun` 为指向 `ustsacm.fun` 的已代理 CNAME；
- GitHub Pages 域名验证 TXT 记录仍存在且保持 DNS only；
- Cloudflare SSL/TLS 当前模式为 `Full (strict)`；
- 生产边缘证书主体为 `ustsacm.fun`，SAN 同时覆盖 `ustsacm.fun` 与 `*.ustsacm.fun`，签发方为 Google Trust Services，当前有效期为 2026-07-20 至 2026-10-18；
- 真实 Chrome 再次访问 `https://greenthree.github.io/USTSACMLand/` 后落到 `https://ustsacm.fun/`。

本轮没有切换根域或 `www` 的代理状态，也没有删除 GitHub Pages 自定义域名。实际 DNS only / GitHub Pages 自定义域名回滚会短暂改变生产流量路径，应在明确维护窗口和项目负责人再次确认后执行。

同日使用已登录的生产管理员会话在 `https://ustsacm.fun/account` 完成个人数据文件实际下载：页面返回成功状态，下载文件可解析为版本化 JSON，包含本人账号、平台、同步、每日一题、训练目标、推荐计划遗留数据和私有 WebChat 历史；敏感键递归扫描命中数为 `0`，文件没有进入仓库或 CI Artifact。详细脱敏记录见 [`personal-data-export-production-2026-07-20.md`](./personal-data-export-production-2026-07-20.md)。因此新域名下的首页、深链、认证、账号页、个人数据导出和后台入口复合验收已完成；只剩独立的 DNS / 自定义域名回滚演练保持未完成。
