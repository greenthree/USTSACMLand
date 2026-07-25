# WebChat 当前模型缓存渠道生产观测（2026-07-25）

## 结论

生产 `webchat-cache-probe` 只手动运行一次 `streaming + declared_implicit` 对照，没有工作流、客户端或 Edge Function 自动重试。探针成功完成两次预定的合成上游请求，第二次复用了 2,432 个输入 Token，证明当前生产模型的缓存字段能够从上游经中转站和 Supabase Edge Function 完整进入脱敏报告。

本次运行同时确认，Supabase Vault 中的当前 WebChat 运行时模型已经不是 ROADMAP 原任务所写的 GPT-5.6，而是 `grok-4.5`；响应报告中的实际模型为 `grok-4.5-build-free`。因此本次证据只关闭“当前模型缓存是否可用”的疑问，不能冒充 GPT-5.6 的具体渠道验收，也没有为了探测而修改生产模型。

## 受控运行

- GitHub Actions：[`30156172616`](https://github.com/greenthree/USTSACMLand/actions/runs/30156172616)
- 触发方式：仅 `workflow_dispatch`
- 传输：`streaming`
- 缓存策略：`declared_implicit`
- 探针结果：`cache_hit`
- 自动重试：无
- Artifact：只包含脱敏诊断，保留 14 天

探针从 Supabase Vault 读取生产运行时配置。GitHub Actions 不持有中转站 Base URL、API Key 或模型配置；Artifact 不包含 Prompt、回复、成员身份、Base URL、API Key 或完整缓存键。

## Usage 与路由元数据

| 请求 | 输入 Token | 输出 Token | 缓存输入 Token | Cache write Token | 响应模型              |
| ---- | ---------: | ---------: | -------------: | ----------------: | --------------------- |
| 1    |      2,522 |        101 |            128 |              缺失 | `grok-4.5-build-free` |
| 2    |      2,542 |        137 |          2,432 |              缺失 | `grok-4.5-build-free` |

`cache_write_tokens` 缺失表示当前渠道没有返回该可选计数，不表示缓存失败；第二次非零 `cached_tokens` 已直接证明缓存读取发生。两次请求合计结算 5,302 Token，缓存输入合计 2,560 Token。

供中转站后台定位的合成请求 ID：

| 请求 | 本站请求 ID                                                  | Responses ID                           |
| ---- | ------------------------------------------------------------ | -------------------------------------- |
| 1    | `webchat-cache-probe:db8fc5df-20bb-4301-93f8-700c43b740d5:1` | `abe7cb6b-da6a-922c-a6da-4c6090009348` |
| 2    | `webchat-cache-probe:db8fc5df-20bb-4301-93f8-700c43b740d5:2` | `0a352d06-7594-9fb7-b546-d95efc6afce8` |

本次响应没有返回可用的上游 `x-request-id` 或 `system_fingerprint`。若以后重新启用 GPT-5.6，必须等待探针冷却窗口结束后只运行一次，再使用新的脱敏请求 ID 在中转站后台核对具体渠道、真实上游模型、`prompt_cache_key`、`prompt_cache_options` 和 Usage 字段透传；在取得这些后台证据前，ROADMAP 的 GPT-5.6 渠道项保持未完成。
