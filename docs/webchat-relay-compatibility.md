# WebChat 中转站兼容性历史记录

> 归档边界：WebChat / AI 学习助手已退出当前产品范围。本文件只保存既有协议设计与历史验收结论，不是启用、换站或生产烟测手册。正常维护不得运行付费中转站工作流或缓存探针，不得新增、读取或轮换中转站凭据，也不得把任何 WebChat 开关设为 `true`。未来只有项目负责人重新立项后，才能另行编写新的产品、隐私、安全与启用方案。

## 历史协议基线

遗留 WebChat Edge Function 使用 OpenAI Responses HTTP API。历史流式消费者按 typed server-sent events 处理：

- `response.created`
- `response.output_text.delta`
- `response.completed`
- `error`

最终 Token Usage 位于 `response.completed.response.usage`。生产实现固定发送 `tools: []` 与 `tool_choice: none`，接受可见的 `response.refusal.delta`，并拒绝工具事件、伪装成正文的 `TOOLCALL`、缺少终态 Usage、畸形 JSON、非 SSE Content-Type、半途断流和未知终态。模型正文在 Edge Function 内完整缓冲，只有协议检查和额度结算成功后才一次性返回，因此异常上游的半截输出不会进入浏览器或历史会话。

历史请求使用由“模型 + 系统提示词版本”派生的 64 位 SHA-256 `prompt_cache_key`。该键不包含成员身份或对话正文，更换模型或 `CHAT_SYSTEM_PROMPT_VERSION` 会改变键。Prompt Caching 仍受至少 1,024 个输入 Token 的精确重复前缀门槛约束，短对话的 `cached_tokens = 0` 不代表故障。

## 历史安全边界

完整协议验收器曾从受控环境读取 `CHAT_RELAY_BASE_URL`、`CHAT_RELAY_API_KEY` 和 `CHAT_RELAY_MODEL`。真实值不得写入 `.env.example`、命令参数、PR、Issue、截图、聊天、日志或 Artifact。历史报告只保留事件类型、时延、聚合 Usage、缓存命中和 Abort 结果，不保存 Prompt、模型回复、请求 ID、API Key、明文主机、Supabase 身份或响应原文。

`webchat-cache-probe` 使用 `production-operations` Environment 中的 `SUPABASE_PROJECT_REF` 与 `SUPABASE_SERVICE_ROLE_KEY` 调用服务端函数，再由 Supabase 内部读取 Vault。中转站 Base URL、模型和 Key 不复制到 GitHub 仓库级或组织级 Secret。探针拒绝浏览器 Origin、要求 service role 身份、固定计入两次全站请求、30 分钟内最多执行一次且不自动重试。

这些边界继续作为遗留代码的安全回归约束，但不授权再次连接模型或产生费用。

## 历史验收结论

- 2026-07-18 的生产 run [`29650242439`](https://github.com/greenthree/USTSACMLand/actions/runs/29650242439) 曾完成一次无重试缓存复核：首个请求输入 2,335 Token、缓存命中 0，第二个相同请求命中 1,792 个输入 Token。脱敏记录见[生产命中证据](./evidence/webchat-input-cache-production-smoke-2026-07-18.md)。
- 2026-07-19 的两次兼容性试验确认 typed `input_text` 内容块级 `prompt_cache_breakpoint` 形状会在首个请求收到 HTTP 400。后续历史实现改用普通 `role/content` 消息，并只为直接 GPT-5.6+ 模型 ID 使用已验证的请求级隐式缓存策略。
- 历史真实成员长会话的追加请求曾命中 6,912 个缓存输入 Token；渠道差异诊断见 `docs/evidence/webchat-cache-route-diagnostics-2026-07-19.md`。

这些结果只描述当时的中转站、模型和实现，不能证明当前或未来供应商兼容，也不得作为重新启用的依据。

## 当前关闭状态

截至 2026-08-09，生产必须同时保持：

- 数据库成员请求开关关闭；
- `CHAT_ENABLED=false`；
- `VITE_WEBCHAT_UI_ENABLED=false`；
- `VITE_WEBCHAT_IMAGE_INPUT_ENABLED=false`；
- `CHAT_VISION_ENABLED=false`；
- `WEBCHAT_IMAGE_CLEANUP_ENABLED` 缺失或为 `false`。

成员端不得显示入口、发起模型请求、上传图片或新增额度账目。管理员后台只保留关闭状态和历史账目的维护入口。既有私有会话、额度账本、图片元数据和 Storage 对象继续受 RLS、注销、备份与恢复下限约束。

关闭态维护只允许修复安全问题、Schema 兼容和数据保护回归。完成此类修改后，运行不访问中转站的本地/CI 测试、严格 Supabase readiness 与生产安全检查，并确认没有新请求或额度记录；不得运行历史付费工作流、缓存探针或真实模型调用。
