# WebChat Pages 客户端入口生产验证（2026-07-18）

## 范围

- 正式站点：`https://greenthree.github.io/USTSACMLand/`
- 发布提交：`5ce774929127c7c47b97e06c09140bd8257ce93b`
- Pages workflow：`29594758865`，attempt 2
- 客户端开关：GitHub 仓库变量 `VITE_WEBCHAT_UI_ENABLED=true`

本文只记录不含凭据的发布事实，不包含成员身份、密码、JWT、中转站地址、API Key 或聊天正文。

## 发布结果

- build 成功，生产配置校验确认 `VITE_WEBCHAT_UI_ENABLED` 只能是 `true`/`false`，并使用同一项目的 `VITE_SUPABASE_URL` 构建客户端。
- deploy 成功，将当前 `main` 的静态 Artifact 发布到 GitHub Pages。
- `production-ranking-audit` 成功，部署后的公开榜单仍拒绝演示回退，并通过正式数据复算。
- `webchat` v5、服务端 `CHAT_ENABLED=true`、数据库请求开关与逐账号授权边界保持不变；打开客户端入口不等于向所有账号授予模型权限。

## 浏览器验证

- 未登录访问正式首页只显示“登录”，不显示成员专用导航。
- 未登录直达 `/USTSACMLand/assistant` 后进入 `/USTSACMLand/login?returnTo=%2Fassistant`，标题为“登录 | USTS ACM Land”。
- 使用已由管理员授权的测试账号登录后自动返回 `/USTSACMLand/assistant`。
- 已登录主导航出现且仅出现一个“AI 助手”链接，目标为 `/USTSACMLand/assistant`。
- 工作台显示当前模型 `gpt-5.6-sol`、本人北京时间当日请求/Token 额度和重置时间；不显示 Base URL、Key、全站预算或他人额度。
- 页面 URL、标题、主要内容和工作台均正确，无框架错误覆盖层，浏览器 console 无 warning/error。
- `documentElement.scrollWidth` 未超过视口宽度，页面没有横向溢出。

## 剩余观察

客户端入口已经可用，但总功能仍处于受控试运行阶段。下一步是在后台扩展到 3–5 名成员，维持逐账号额度与全站预算，连续观察流式稳定性、Abort、超时、429、重复请求结算和中转站用量；出现异常时先关闭数据库请求开关，再按需要恢复服务端和 Pages 开关。
