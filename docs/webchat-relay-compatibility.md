# WebChat 中转站兼容性验收

本文定义 USTS ACM Land 在配置或更换 AI 中转站时必须执行的真实协议验收。该验收会产生少量模型费用，但不会部署 Edge Function、开启 WebChat 或保存对话正文。

## 协议基线

WebChat Edge Function 使用 OpenAI Responses HTTP API。官方文档要求流式响应使用 typed server-sent events；文字流至少关注：

- `response.created`
- `response.output_text.delta`
- `response.completed`
- `error`

最终 Token Usage 位于 `response.completed.response.usage`。本项目同时接受可见的 `response.refusal.delta`，但拒绝缺少终态 Usage、畸形 JSON、非 SSE Content-Type、半途断流或未知终态。

参考：

- [Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses?api-mode=responses)
- [Migrate to Responses：更新流式消费者](https://developers.openai.com/api/docs/guides/migrate-to-responses#7-update-streaming-consumers)
- [Create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create)

## 安全边界

验收器只从环境变量读取：

- `CHAT_RELAY_BASE_URL`：不含凭据、查询参数或 fragment 的 HTTPS 基地址；脚本自动追加 `/responses`。
- `CHAT_RELAY_API_KEY`：专用中转站 Key。
- `CHAT_RELAY_MODEL`：中转站实际接受的 Responses 模型 ID。

禁止把三项真实值写入 `.env.example`、命令参数、PR、Issue、截图或聊天。GitHub 工作流只允许 `workflow_dispatch` 手动触发，不监听 `push`、`pull_request`、`schedule` 或 `workflow_run`，避免无意产生费用。默认执行 Abort 检查；只有排查供应商故障时才可在手动表单中临时关闭，关闭后的结果不能作为上线证据。

报告只包含：

- 中转站主机的 SHA-256 和 `/responses` 路径。
- 请求模型与实际返回模型。
- 事件类型、增量次数、可见字符数、首增量/总时延。
- 输入、输出和总 Token 数。
- Abort 后流的结束方式和耗时。

报告不包含 Prompt、模型回复、请求 ID、API Key、明文中转站主机、Supabase 身份或响应原文。

## 本地运行

在不进入 shell 历史的受控环境中注入三项变量，然后执行：

```powershell
npm run check:webchat-relay-workflow
npm run check:webchat-relay
```

可选运行参数：

```text
WEBCHAT_RELAY_TIMEOUT_MS=120000
WEBCHAT_RELAY_ABORT_SETTLE_MS=2000
WEBCHAT_RELAY_ABORT_CHECK=true
WEBCHAT_RELAY_REPORT_PATH=artifacts/webchat-relay-compatibility.json
```

成功条件：

1. 非流式 `/responses` 返回 JSON、可见文字、实际模型和内部一致的 Usage。
2. 流式请求返回 `text/event-stream`，先出现 `response.created`，随后出现至少一个文字/拒绝增量，最终以带 Usage 的 `response.completed` 结束。
3. Abort 检查在首个可见增量后主动中止长输出，客户端读取在 2 秒内以 Abort 或连接关闭结束。
4. 脱敏 JSON 的 `status` 为 `passed`，且人工抽查不存在上述禁止字段。

“客户端连接关闭”只能证明中转站接受 HTTP Abort，不能单独证明供应商停止计费。首次生产启用前还应在中转站控制台对照该次测试的 Usage/请求状态；若供应商不能提供可核验状态，按保守额度结算并记录该限制。

## GitHub 手动工作流

1. 在仓库 Actions Secrets 中添加 `CHAT_RELAY_BASE_URL`、`CHAT_RELAY_API_KEY`、`CHAT_RELAY_MODEL`。
2. 打开 Actions → `WebChat relay compatibility` → Run workflow。
3. 保持 `include_abort=true`，运行当前候选分支。
4. 确认任务通过，下载 `webchat-relay-compatibility-<run_id>` Artifact。
5. 抽查报告结构和禁止字段；Artifact 14 天后自动删除。

该工作流不得加入 required status checks，也不得改为自动运行。它是有费用、需要当前生产中转站 Secret 的受控发布验收。

## 通过后的部署顺序

1. 保持 `VITE_WEBCHAT_UI_ENABLED=false`、Supabase `CHAT_ENABLED=false` 与数据库成员请求开关关闭。
2. 应用 WebChat 配额与中转站配置 migration，并确认空库 pgTAP 与生产 migration 列表一致。
3. 将精确 Origin、输出/请求上限、额度和租约写入 Supabase Function Secrets，部署 `webchat-config` 与 `webchat`；保持 `CHAT_ENABLED=false`。
4. 管理员在 `/admin/webchat` 写入已通过验收的 Base URL、模型和 API Key，设置全站北京时间每日请求/Token 预算，并继续保持成员请求关闭。确认页面只显示 Key 是否已配置、请求开关、预算、版本和更新时间，配置读取、审计与日志均不含 Key。
5. 验证环境禁用态与数据库暂停态、CORS、匿名拒绝、无逐人授权拒绝、停用/非普通成员拒绝、非管理员配置拒绝、撤权/降额竞态、成员/全站原子额度、乐观锁冲突和有效成员认证。
6. 在成员详情中只为 3–5 名成员开启权限并设置逐人请求/Token 上限；核对成员端剩余额度后受控试用，观察请求数、Token、Abort、超时、429 和重复请求结算。
7. 负责人确认预算、隐私披露和关闭方式后，先开启后端 `CHAT_ENABLED=true`，再由管理员打开数据库成员请求开关；确认健康后，最后在下一次前端构建开启 `VITE_WEBCHAT_UI_ENABLED=true`。

出现协议变化、Usage 缺失、Abort 超时、重复计费、额度绕过或隐私问题时，先关闭数据库成员请求开关，并按需要恢复另外两层为 `false`。只隐藏前端入口不能替代关闭后端模型调用。

## 当前生产状态（2026-07-18）

- 真实中转站的非流式、Responses typed SSE、Usage、Abort、模型标识和系统提示词均已完成受控生产验收。
- 中转站 Base URL、模型和全站预算由私有数据库配置保存，Key 位于 Supabase Vault；浏览器与配置读取接口均不能读取明文 Key。
- `webchat` v5、`CHAT_ENABLED=true` 与数据库请求开关已对显式授权账号启用。
- GitHub 仓库变量 `VITE_WEBCHAT_UI_ENABLED=true` 已随 Pages run `29594758865` attempt 2 发布；未登录直达 `/assistant` 仍进入登录页，只有登录且经后台授权的账号能获得模型调用。
- 仍需扩展到 3–5 名正式试运行成员并完成连续观察；出现协议、额度、隐私或稳定性问题时按上文顺序关闭三层开关。
