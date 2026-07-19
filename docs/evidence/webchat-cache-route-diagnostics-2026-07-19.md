# WebChat 输入缓存路由诊断（2026-07-19）

## 结论

本站已排除输入长度、共享前缀、缓存键、Responses Usage 解析以及流式传输造成的缓存未命中。当前生产中转站对同一个 `gpt-5.6-sol` 模型和相同缓存策略表现不稳定：2026-07-19 早间的追加请求曾命中 1,792 个输入 Token，随后流式和非流式对照均没有任何缓存写入或读取记录。

因此当前最可能的故障点是中转站将请求路由到了不支持 GPT-5.6 Prompt Caching 的上游渠道，或接受了缓存字段但没有向真正上游完整转发。本站不能通过更换缓存键、随机重试或修改前缀来可靠修复该渠道问题。

## 官方协议核对

OpenAI Prompt Caching 文档说明：

- GPT-5.6 及更新模型需要稳定复用 `prompt_cache_key` 才能使用更可靠的缓存匹配；
- `prompt_cache_options.mode` 可为 `implicit`，`ttl` 当前只支持 `30m`；
- 至少 1,024 个输入 Token 才具备缓存资格；
- GPT-5.6 及更新模型分别使用 `cache_write_tokens` 和 `cached_tokens` 报告缓存写入与读取；
- 缓存虽然是路由相关的，但相同缓存键与精确前缀应被路由到可复用缓存的位置。

本站生产探针满足这些条件：输入为 2,335 / 2,356 Token，第二轮完整保留第一轮前缀，缓存键与共享前缀指纹稳定，并显式发送 `implicit` + `30m`。

官方依据：[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)。

## 已完成的诊断改造

Draft PR [#92](https://github.com/greenthree/USTSACMLand/pull/92) 为 service-role-only 生产探针增加了以下脱敏信息：

- 客户端请求 ID、上游 `x-request-id` 和 Responses `response.id`；
- 实际响应模型、service tier 与 system fingerprint；
- 两次请求体及共享前缀的 SHA-256 指纹；
- 缓存键的 16 位脱敏前缀；
- streaming / non-streaming 与显式 / 默认 implicit 单变量对照；
- `cache_hit`、`cache_write_without_read`、`cache_write_telemetry_unavailable` 和 `no_cache_write_or_read` 分类。

Artifact 不包含 Prompt、API Key、Base URL、完整缓存键或成员对话。探针仍保持 30 分钟冷却、两次合成请求、无自动重试且不扣成员额度。

PR 提交 `77fe902` 的 `verify`、`database-security` 和 `gitleaks` 已全部通过；生产 `webchat-cache-probe` 已使用仓库 import map 部署为 ACTIVE v11。

## 三次生产观测

### 曾经命中

Actions run [`29665061228`](https://github.com/greenthree/USTSACMLand/actions/runs/29665061228)：

- 第一次输入 2,335 Token，命中 0；
- 第二次输入 2,356 Token，命中 1,792；
- 证明该中转站至少有一个渠道曾正确复用前缀并回传 Usage。

### 流式未命中

Actions run [`29672691083`](https://github.com/greenthree/USTSACMLand/actions/runs/29672691083)：

- streaming；
- `declared_implicit`；
- 两次均为 `cached_tokens=0`、`cache_write_tokens=0`；
- 未自动重试。

### 非流式对照仍未命中

Actions run [`29673642726`](https://github.com/greenthree/USTSACMLand/actions/runs/29673642726)：

- non-streaming；
- 实际响应模型均为 `gpt-5.6-sol`；
- service tier 均为 `default`；
- 共享前缀指纹为 `c9d4b40318cc66f9af3ffa10346284a2d2afaa3bcfb4f5ada86f21d750177a4c`；
- 第一次：`cached_tokens=0`、`cache_write_tokens=0`；
- 第二次：`cached_tokens=0`、`cache_write_tokens=0`；
- 诊断为 `no_cache_write_or_read`。

中转站后台应按以下编号定位两次请求的实际渠道及转发请求体：

| 轮次 | 本站请求 ID                                                  | 中转站 / 上游请求 ID                   | Responses ID                                              |
| ---- | ------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------- |
| 1    | `webchat-cache-probe:2e3b207d-09cb-4c84-9516-4b31bd6b7401:1` | `b2267f1f-1b19-4030-80a0-a1dda4434a08` | `resp_075aeebd493af5ac016a5c54f5d0548197b7819add76b49133` |
| 2    | `webchat-cache-probe:2e3b207d-09cb-4c84-9516-4b31bd6b7401:2` | `2ab54723-bac9-4f7d-be7b-64562a392251` | `resp_06e27624e5a0910f016a5c54f6f7e48195b1afed0249b03943` |

非流式仍失败，排除了 streaming 与 non-streaming 走不同缓存链路是唯一原因；实际模型一致，也排除了本站请求模型名被直接改写。`cache_write_tokens=0` 是最关键证据：真正支持当前 GPT-5.6 缓存协议的上游应报告缓存写入，因此要优先检查渠道能力与缓存字段是否被中转站过滤。

## 后续修复条件

管理员需要在中转站后台使用上述请求编号确认：

1. 两次请求被分配到哪个具体渠道；
2. 该渠道实际使用的上游模型，而不只是返回给客户端的模型别名；
3. 是否完整转发 `prompt_cache_key` 和 `prompt_cache_options`；
4. 是否完整转发上游 `usage.input_tokens_details.cache_write_tokens` 与 `cached_tokens`；
5. 是否可以将 `gpt-5.6-sol` 固定到明确支持 GPT-5.6 Prompt Caching 的渠道。

完成渠道调整后，应等待 30 分钟冷却并只运行一次相同探针。只有第二轮 `cached_tokens > 0`、或先观测到可信的 `cache_write_tokens > 0` 后再按计划复核读取，才能关闭 ROADMAP 中的差异排查任务。
