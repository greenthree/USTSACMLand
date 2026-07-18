# WebChat 历史会话与缓存路由键生产发布证据

日期：2026-07-18（Asia/Shanghai）

## 发布内容

- PR [#67](https://github.com/greenthree/USTSACMLand/pull/67) 合并提交：`39ffffed65ef2ea85cf0243260ab4fa6b51f9b20`。
- Supabase 已应用第 50 个 migration：`202607180005_webchat_conversation_history.sql`。
- `webchat` Edge Function 已部署为 ACTIVE v9，生产请求携带由模型与系统提示词版本派生的稳定 `prompt_cache_key`。
- GitHub Pages 已发布刷新恢复、历史会话、新建/切换/删除、自动标题和首正文前“思考中”界面。

## 自动门禁

- PR CI run [`29645857832`](https://github.com/greenthree/USTSACMLand/actions/runs/29645857832)：PostgreSQL 17 从空库应用 50 个 migration，30 个 pgTAP 文件、738 项断言通过。
- 主分支 CI run [`29646206220`](https://github.com/greenthree/USTSACMLand/actions/runs/29646206220)：345 项 Vitest、150 项通用浏览器测试、58 项 WebChat 浏览器测试、构建、Deno check/lint 和 338 项 Edge Function 测试通过。
- Pages run [`29646490889`](https://github.com/greenthree/USTSACMLand/actions/runs/29646490889)：build、deploy 和生产榜单审计通过。

## 生产核对

- 远端 migration 列表中本地与生产 `202607180005` 已对齐。
- Supabase Functions 列表显示 `webchat` 状态为 ACTIVE、版本为 9、JWT 校验和 import map 均启用。
- 正式入口返回新构建资源 `index-BAmnQ2Cu.js`，懒加载资源 `AssistantPage-UzqvThtp.js` 包含“历史对话”“思考中”“最长保留 180 天”。
- GitHub Pages 对 SPA 深链 `/assistant` 返回发布的 `404.html` 回退正文；浏览器由 React Router 接管该路径。

## 缓存命中验证状态

手动工作流 run [`29646649195`](https://github.com/greenthree/USTSACMLand/actions/runs/29646649195) 在模型请求前安全失败，因为仓库尚未配置 `CHAT_RELAY_BASE_URL`、`CHAT_RELAY_API_KEY`、`CHAT_RELAY_MODEL`。因此该运行没有产生模型费用，也没有真实 `cached_tokens` 证据。

生产请求代码和手动探针均已使用稳定 `prompt_cache_key`。完成项仍需：把当前中转站三项值写入 GitHub Actions Secrets，保持 `include_cache_probe=true` 重新运行；首个探针请求必须达到 1024 个输入 Token，第二个相同请求必须返回 `input_tokens_details.cached_tokens > 0`。

## 仍存在的既有运维缺口

本次发布前预检继续报告三个与本功能无关的既有阻塞项：同步告警 Webhook 的 URL/Token、注销恢复 GitHub Token，以及三个 Schema Advisor finding。本次没有伪造 Secret、关闭门禁或扩大改动范围。
