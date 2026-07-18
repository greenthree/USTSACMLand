# WebChat 中转站兼容性验收

本文定义 USTS ACM Land 在配置或更换 AI 中转站时必须执行的真实协议验收。该验收会产生少量模型费用，但不会部署 Edge Function、开启 WebChat 或把验收 Prompt/回复写入本站历史会话表。

## 协议基线

WebChat Edge Function 使用 OpenAI Responses HTTP API。官方文档要求流式响应使用 typed server-sent events；文字流至少关注：

- `response.created`
- `response.output_text.delta`
- `response.completed`
- `error`

最终 Token Usage 位于 `response.completed.response.usage`。本项目同时接受可见的 `response.refusal.delta`，但拒绝缺少终态 Usage、畸形 JSON、非 SSE Content-Type、半途断流或未知终态。

每次生产请求还携带由“模型 + 系统提示词版本”派生的 64 位 SHA-256 `prompt_cache_key`，同一配置使用稳定键，不包含成员身份或对话正文。OpenAI Prompt Caching 只会对至少 1024 个输入 Token 的精确重复前缀产生命中；因此短对话显示 `cached_tokens = 0` 属于正常行为。稳定键用于提高同一前缀被路由到同一缓存的概率，不会绕过 1024 Token 门槛，也不能保证第三方中转站真实透传或计费。更换模型或 `CHAT_SYSTEM_PROMPT_VERSION` 会自动更换键，避免不同提示版本混用。

参考：

- [Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses?api-mode=responses)
- [Migrate to Responses：更新流式消费者](https://developers.openai.com/api/docs/guides/migrate-to-responses#7-update-streaming-consumers)
- [Create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

## 安全边界

完整中转站协议验收器只从环境变量读取：

- `CHAT_RELAY_BASE_URL`：不含凭据、查询参数或 fragment 的 HTTPS 基地址；脚本自动追加 `/responses`。
- `CHAT_RELAY_API_KEY`：专用中转站 Key。
- `CHAT_RELAY_MODEL`：中转站实际接受的 Responses 模型 ID。

禁止把三项真实值写入 `.env.example`、命令参数、PR、Issue、截图或聊天。完整协议工作流只允许 `workflow_dispatch` 手动触发，不监听 `push`、`pull_request`、`schedule` 或 `workflow_run`，避免无意产生费用。默认执行 Abort 和 Prompt Caching 检查；只有排查供应商故障时才可在手动表单中临时关闭，关闭后的结果不能作为完整上线证据。

生产缓存复核使用独立的 `webchat-cache-probe` Edge Function。GitHub 只提供现有 `SUPABASE_PROJECT_REF` 和 `SUPABASE_SERVICE_ROLE_KEY`，函数在 Supabase 内部通过 service-role-only RPC 读取 Vault 中已经保存的 Base URL、模型和 API Key；三项中转站配置不再复制到 GitHub。函数拒绝浏览器 `Origin`，Gateway 先验证 Bearer JWT，函数内再要求它与当前运行时 service role Key 一致，或其已验证 Payload 明确包含 `role=service_role`，从而兼容项目轮换后仍有效的 service-role JWT。一次探针固定计入全站两次请求，Token 则按两次请求 JSON 的 UTF-8 字节、最大输出与协议余量动态保守预留；它不扣任何成员额度，不自动重试，30 分钟内只允许一次。开始前失败会回滚请求数和 Token 预留，开始后 Usage 缺失或异常超过预留则按预留上限计入未知用量并让探针失败。

完整协议验收报告只包含：

- 中转站主机的 SHA-256 和 `/responses` 路径。
- 请求模型与实际返回模型。
- 事件类型、增量次数、可见字符数、首增量/总时延。
- 输入、输出和总 Token 数。
- 缓存探针首、次请求的 `cached_tokens`、可用时的 `cache_write_tokens`，以及第二次实际复用的输入 Token 数。
- Abort 后流的结束方式和耗时。

生产缓存报告进一步只保留模型、两次请求的时延与聚合 Usage、`cached_tokens`、可用时的 `cache_write_tokens`、全站剩余额度和结算 Token；不保存中转站主机哈希或路径。两类报告都不包含 Prompt、模型回复、请求 ID、API Key、明文中转站主机、Supabase 身份或响应原文，Artifact 均在 14 天后删除。

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
WEBCHAT_RELAY_CACHE_CHECK=true
WEBCHAT_RELAY_REPORT_PATH=artifacts/webchat-relay-compatibility.json
```

成功条件：

1. 非流式 `/responses` 返回 JSON、可见文字、实际模型和内部一致的 Usage。
2. Prompt Caching 探针连续发送两次完全相同的长前缀请求，首个请求的 `input_tokens >= 1024`，第二个请求的 `input_tokens_details.cached_tokens > 0`；否则任务以 `cache_probe_*` 错误失败。
3. 流式请求返回 `text/event-stream`，先出现 `response.created`，随后出现至少一个文字/拒绝增量，最终以带 Usage 的 `response.completed` 结束。
4. Abort 检查在首个可见增量后主动中止长输出，客户端读取在 2 秒内以 Abort 或连接关闭结束。
5. 脱敏 JSON 的 `status` 为 `passed`，且人工抽查不存在上述禁止字段。

普通短问答不能作为缓存失败证据。如果专用探针仍为 `cache_probe_miss`，说明中转站没有把同一 `prompt_cache_key` 与精确前缀稳定路由至支持缓存的上游，或没有回传真实 `cached_tokens`；应先在中转站确认 `/responses` 请求体字段透传和 Usage 映射，再考虑应用层改动。

“客户端连接关闭”只能证明中转站接受 HTTP Abort，不能单独证明供应商停止计费。首次生产启用前还应在中转站控制台对照该次测试的 Usage/请求状态；若供应商不能提供可核验状态，按保守额度结算并记录该限制。

## GitHub 手动工作流

### 完整协议与 Abort 验收

1. 在仓库 Actions Secrets 中添加 `CHAT_RELAY_BASE_URL`、`CHAT_RELAY_API_KEY`、`CHAT_RELAY_MODEL`。
2. 打开 Actions → `WebChat relay compatibility` → Run workflow。
3. 保持 `include_abort=true`、`include_cache_probe=true`，运行当前候选分支。
4. 确认任务通过，下载 `webchat-relay-compatibility-<run_id>` Artifact。
5. 抽查报告结构和禁止字段；Artifact 14 天后自动删除。

该工作流不得加入 required status checks，也不得改为自动运行。它是有费用、需要当前生产中转站 Secret 的受控发布验收。

### 已配置生产环境的缓存复核

部署 `202607180006_webchat_cache_probe_accounting.sql` 和 `webchat-cache-probe` 后：

1. 确认管理员后台保存的中转站配置完整、数据库请求开关开启，且全站当日还允许至少 2 次请求，并有足够 Token 余额容纳函数根据两次请求 JSON、最大输出与协议余量动态计算的保守预留。
2. 打开 Actions → `WebChat production cache probe` → Run workflow。
3. 工作流使用仓库中已经存在的 `SUPABASE_PROJECT_REF` 与 `SUPABASE_SERVICE_ROLE_KEY`；不要新增或复制 `CHAT_RELAY_*` Secret。
4. 确认首个请求 `inputTokens >= 1024`，第二个请求 `cachedInputTokens > 0`，下载 `webchat-production-cache-probe-<run_id>` Artifact。
5. 若返回 `cooldown`，按 `retry-after` 等待；若返回 `cache_probe_miss`，到中转站核对 `prompt_cache_key`、精确请求前缀和 `input_tokens_details.cached_tokens` 的透传。工作流和函数都不会自动重试。

该探针只验证当前 Supabase Vault 配置实际走通后的缓存读写，不替代首次接入或更换中转站时的完整非流式、流式和 Abort 兼容性验收。

## 通过后的部署顺序

1. 保持 `VITE_WEBCHAT_UI_ENABLED=false`、Supabase `CHAT_ENABLED=false` 与数据库成员请求开关关闭。
2. 应用 WebChat 配额与中转站配置 migration，并确认空库 pgTAP 与生产 migration 列表一致。
3. 将精确 Origin、输出/请求上限、额度和租约写入 Supabase Function Secrets，部署 `webchat-config`、`webchat` 与 service-role-only `webchat-cache-probe`；保持 `CHAT_ENABLED=false`。
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
