# ADR 0009：洛谷通过 Firecrawl 获取认证记录页

- 状态：初版及逐请求轮换修订已发布；18 请求 / 7 Key 的单成员跨页验收成功，全体自然日更待观察
- 日期：2026-10-19

## 背景

项目负责人要求洛谷改用 Firecrawl。当前生产直接请求记录接口仍失败；此前 Lentille JSON 修复只完成本地验证。Firecrawl 对公开记录页的正常请求取得唯一 `script#lentille-context[type="application/json"]`，其 envelope 为 `template: error`、`status: 401`、`data.errorCode: 401`，证明更换获取服务仍需要专用洛谷登录态。这不证明现有生产 Cookie 已失效。

## 决策

1. 获取层改为 Firecrawl `/v2/scrape`，请求 `/record/list?user=<uid>&page=<n>&status=12` 的 `rawHtml`。专用 Cookie/CSRF 仅在服务端从 Secret 读取，随请求 headers 交给 Firecrawl；不读取或复制负责人浏览器的会话。
2. 设置 `maxAge: 0`、`storeInCache: false`、`onlyMainContent: false`、`proxy: basic`。不创建持久 profile，不请求增强代理、截图、会话录制或登录交互；挑战页失败关闭，应用请求无内联重试。
3. 严格验证响应状态、目标 UID、页码、Accepted 筛选和唯一 Lentille 上下文；只保留记录 ID、提交时间、Accepted 状态和 PID。查看者对象、CSRF 及其他上下文不返回给增量层，也不写日志或数据库。
4. 继续使用 `data.records.result` 的严格解析；仅对 P/B PID 去重，精确记录 ID/时间游标、总量校验、受限重建、30 天校准、分页上限、失败保留和原子提交不变。不能用公开总题数替代或把截断历史当成功。
5. 初版通过前向 migration 将既有 service-only Key 池的 purpose 扩展为 `luogu`。后续负责人确认各 Key 来自不同 Firecrawl 团队，要求按 API 调用轮换：每次实际 `/scrape` 请求（含重建时重读同一页）使用 `luogu:<job>:<attempt>:<account>:request:<n>` 独立 claim，选取最久未使用的合格 Key，优先级只用于同时间的排序。停用、认证失败、冷却和零额度 Key 不参与；池内只有一个合格 Key 时会复用，没有合格 Key 时失败关闭。失败不会在同一 attempt 改 Key 重发该请求，仍最多一次持久队列重试。上游洛谷的认证/限流状态不隔离 Firecrawl Key。
6. 同步更新隐私文案和第三方数据说明。禁用页面缓存不保证供应商零保留；当前普通请求的作业留存边界继续适用。

## 成本与验收

每页消耗一次抓取请求；首次全量与定期校准按 Accepted 页数增加成本和耗时。发布前必须用明确批准的受控成员确认凭据转发、实际响应契约、全部所需分页、Edge 时间预算、额度和清理边界，不能只用合成 fixture 宣称恢复。达到页数或运行时间限制应失败保留旧值，不能写入部分统计。

QOJ 不随此设计更换获取方式或轮换凭据。其现有错误只能定位到提交后未确认登录成功，需单独受控诊断。

## 逐请求轮换修订

原选择器先按固定优先级选 Key；生产优先级各不相同，因此仅把调用移到分页循环不能轮换。新增 `202610190002_luogu_firecrawl_request_rotation.sql` 只调整 `luogu` 的选择顺序，保留 QOJ/牛客优先级、RPC 签名、service-only 权限和已有 operation claim。旧 `sync-member` 在新 Schema 下仍兼容；新消费者必须在该迁移后发布。策略不绑定 Key 数量，已配置的 7 个中只使用启用且合格者。

此次修订不改变第三方字段、专用 Cookie/CSRF、抓取频率、基础代理、页面校验、原子提交或次数上限。Firecrawl HTTP 429 明确标记服务来源，限流 Key 保持冷却；不据此声称限流已解决。完整验证和待批准发布范围见 [逐请求轮换记录](../luogu-firecrawl-request-rotation-2026-10-19.md)。

## 兼容、部署与回滚

- 先完成本地 migration、pgTAP、Edge、前端隐私文案和发布门禁；既有 Auth 缺口明确保留，本次不扩大范围。生产相同的 76 迁移基线下已单独验证洛谷迁移与 188 项相关断言，证明没有 Auth 数据库依赖；本次申请的定向执行范围、HTTPS 管理通道、真实迁移历史与回滚见 [独立发布准备](../luogu-firecrawl-release-2026-10-19.md)。不把定向验证视为完整 readiness 通过。
- 新 migration 只扩展 purpose 和 claim 约束，保持 RPC 签名、权限和旧 QOJ/牛客调用兼容；不会触发业务同步或修改成员统计。
- 负责人已在本次会话批准 migration、`sync-member`、`sync-stats`（额度检查/单成员过滤）、隐私文案发布，以及一次受控洛谷 smoke；实际执行结果以发布证据为准。QOJ 不在本次烟测范围，不使用平台批量范围冒充单成员烟测。
- 回滚只恢复兼容旧函数源码，保留新增 Schema 和现有统计；不回写 migration、不清空增量状态。旧生产基线仍无法恢复洛谷，回滚只恢复此前失败保留行为。
