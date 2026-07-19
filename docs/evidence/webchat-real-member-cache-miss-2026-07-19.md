# WebChat 真实成员输入缓存未命中证据（2026-07-19）

## 验收目标

在生产站点使用一个已经获得 AI 助手权限的普通成员账号，完成“长首轮 + 同一会话追加第二轮”，确认真实成员请求是否像生产缓存探针一样返回非零 `cached_tokens`。

本次只记录不含身份和正文的聚合 Usage。证据不包含成员 UUID、会话 ID、请求 ID、Prompt、回复、中转站地址或密钥。

## 操作结果

- 第一轮输入超过 1024 Token，并成功获得模型回复。
- 第二轮在同一会话追加短消息，模型正确延续上下文并成功回复。
- 成员累计请求数从 4 增加到 6，已结算 Token 从 6,416 增加到 21,930，证明两次请求均已完成额度结算。
- 服务端只读查询最近两条已完成的真实成员请求，结果如下。

| 北京时间            | 输入 Token | 输出 Token | 总 Token | 缓存输入 Token | 缓存写入 Token | 结果      |
| ------------------- | ---------: | ---------: | -------: | -------------: | -------------: | --------- |
| 2026-07-19 07:37:41 |      7,737 |          6 |    7,743 |              0 |              0 | completed |
| 2026-07-19 07:38:26 |      7,765 |          6 |    7,771 |              0 |              0 | completed |

第二轮只比第一轮多 28 个输入 Token，符合保留长首轮并追加助手回复和短用户消息的会话形状，但两轮 `cached_input_tokens` 都是 0。真实成员路径尚未满足缓存验收退出条件。

## 流式对照结果

在不改变模型、普通 `role/content` 消息、长前缀、追加会话形状和缓存键算法的前提下，将生产探针从非流式切换为与真实成员相同的流式 Responses 请求：

| GitHub Actions run                                                                  | 传输模式        | 第一轮输入 / 写入 | 第二轮输入 / 命中 | 结果   |
| ----------------------------------------------------------------------------------- | --------------- | ----------------: | ----------------: | ------ |
| [`29665061228`](https://github.com/greenthree/USTSACMLand/actions/runs/29665061228) | `stream: false` |         2,335 / 0 |     2,356 / 1,792 | 命中   |
| [`29666030174`](https://github.com/greenthree/USTSACMLand/actions/runs/29666030174) | `stream: true`  |         2,335 / 0 |         2,356 / 0 | 未命中 |

流式 run 从 `response.completed` 成功读取完整 Usage，说明不是本站漏读 SSE Usage；该 run 的 `cache_write_tokens` 和 `cached_tokens` 均为 0，与真实成员请求和中转站日志一致。问题已经收敛到当前中转站的流式 Responses 缓存透传、渠道路由或缓存策略，而不是前端刷新、历史持久化或早期消息前缀。

OpenAI 官方[缓存文档](https://developers.openai.com/api/docs/guides/prompt-caching)说明，超过 1,024 Token 的 Responses 请求可使用 Prompt Caching，`stream: true` 只改变响应交付方式，不会关闭 `prompt_cache_key` 或 `prompt_cache_options`。GPT-5.6 默认使用隐式缓存断点，也允许显式声明请求级 `prompt_cache_options.mode = "implicit"`。

在 30 分钟冷却自然结束后，run [`29666900027`](https://github.com/greenthree/USTSACMLand/actions/runs/29666900027) 保持流式请求、模型、长前缀、追加消息和缓存键不变，只增加请求级 `mode=implicit` 与 `ttl=30m`。首轮输入 2,335 Token、缓存 0；第二轮输入 2,356 Token、命中 1,792 Token。该单变量实验成功，证明当前中转站的流式路径需要显式声明请求级隐式缓存策略。

将相同策略临时部署到真实 WebChat 后，既有长会话的第一条追加请求没有自动重试，并以 `upstream_http_error` 终止；上游未返回可信 Usage，额度按 32,331 Token 的保守预留结算。探针缓存键和生产缓存键不同，而当前 New API 系中转站公开前端包含按 `prompt_cache_key` 的渠道粘性模板，因此最强解释是两个键被绑定到能力不同的上游渠道。该实验性成员改动随即撤回，真实服务恢复原可用请求形状。

对已配置 Base URL 的公开 `/api/status` 和前端静态资源做了不含地址与凭据的只读识别：当前中转站属于 New API 系定制构建，站点标识为 `XCPCAI`，公开版本为无法映射到 New API 官方仓库提交的短哈希。其前端资源包含“渠道粘性”“透传请求体”和 `codex cli trace` 模板入口，说明后台具备相关配置能力；仅凭公开资源无法确认这些开关当前是否已启用，也不能确认一次实验中的两轮是否被固定到同一上游渠道。

New API 公开 issue [#3389](https://github.com/QuantumNous/new-api/issues/3389)、[#6129](https://github.com/QuantumNous/new-api/issues/6129) 和 [#6167](https://github.com/QuantumNous/new-api/issues/6167) 提供了相近现象：维护者建议检查请求头/请求体透传和渠道粘性；另有受控实验显示“自定义渠道 + 透传”可以避免中间层改写破坏上游缓存，Azure 部分区域也曾出现 GPT-5.6 缓存不可用。因此当前证据证明“流式 run 未命中”，但在取得中转站渠道 ID 或确认粘性配置前，不能把根因进一步武断限定为 `stream` 字段本身。

## 下一轮排查顺序

1. 让下一次受控探针使用与真实 WebChat 完全相同的生产缓存键，但仍使用不含成员和正文的固定探针消息；验证该键当前粘性渠道是否接受请求级隐式策略。
2. 如果生产键探针返回 HTTP 错误，在中转站后台确认 `codex cli trace` 渠道粘性、请求体透传和目标渠道一致性，或改用稳定支持 GPT-5.6 流式缓存的渠道。
3. 只有生产键探针通过后，才重新将策略加入真实 WebChat，并把新增字段计入额度指纹和保守 Token 预留。
4. 最终重新执行真实授权成员的追加会话；只有中转站日志和站内脱敏指标都出现 `cached_tokens > 0`，才勾选 ROADMAP 任务。
