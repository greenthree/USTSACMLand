# 洛谷 Lentille 协议本地修复

日期：2026-10-07（Asia/Shanghai）。本记录只证明协议核对与本地验证，不是生产恢复证明。

## 当前证据

内置浏览器成功打开 `/record/list`，页面渲染完成，存在 `lentille-context`、记录筛选框和记录链接。只读取了 DOM 结构与公开静态资源列表，没有读取 Cookie、CSRF、浏览器存储、提交内容或完整页面内嵌状态。

下列资源是该页面当日实际加载的公开客户端源码；通过 Firecrawl 获取静态 JavaScript，未向它传递登录会话或成员资料。缓存位于忽略目录 `.firecrawl/`，不进入 Git。

| 源码                                                                                          | 核对结果                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [vendor.20261007-2290.js](https://fecdn.luogu.com.cn/columba/vendor.20261007-2290.js)         | Lentille 的 `dataTypeHeader` 为 `x-lentille-request`，页面导航发送其值 `content-only`；返回对象直接更新 page context，`Px` 注入的 current data 来自 `registry.data`。分页上限由 `count / perPage` 计算。 |
| [columba~31497e8033eb9960.js](https://fecdn.luogu.com.cn/columba/columba~31497e8033eb9960.js) | `RecordList` 使用 `Px` 的 `records.count` 和 `records.result`；记录使用 `id`、`submitTime`、`problem.pid` 与 `status`，Accepted 为 `12`。筛选参数仍为 `user`、`status`，默认按最新提交排序。             |
| [loader.20261007-2290.js](https://fecdn.luogu.com.cn/columba/loader.20261007-2290.js)         | `record.list` 对应上述 RecordList 模块；页面按 context 的 `template` 选择模块。                                                                                                                          |

旧适配器仍请求 `_contentOnly=1` 并读取 `currentData.records`，与这套客户端协议不一致。新契约明确为 `x-lentille-request: content-only`、`template=record.list`、`data.records.result`，不做 envelope 猜测或 HTML 统计回退。

这些结论来自当前公开客户端源码及正常页面渲染；没有捕获浏览器网络请求头或读取真实 JSON 响应。不能据此断言生产 HTTP 200 HTML 的唯一原因，也不能证明现有 Secret 当前有效。

## 本地修改

- transport 使用 Lentille 内容请求头，删除旧 `_contentOnly` 参数，保留 Cookie/CSRF 的 Secret 消费方式、分页、Accepted 筛选与现有请求上限。
- parser 只接受 `record.list` 的 `data.records`；每条记录必须为数值状态 `12`，否则失败关闭。旧 envelope、其他模板与未知字段结构不被宽泛兼容。
- 合成 fixture 改用新 envelope 和 Accepted 状态；新增 transport、HTML 单次失败、旧 envelope 拒绝和非 Accepted 状态拒绝测试。
- 来源版本更新为 `luogu-lentille-record-list-pb-v5`。
- P/B 去重、精确记录 ID/时间边界、30 天校准、受限重建、分页上限、失败保留旧统计和数据库原子提交逻辑没有修改。

## 验证

- 洛谷专项：33 项通过；平台契约：12 项通过。
- 全量 Edge：495 项通过、0 失败、1 ignored。
- `sync-member` / `sync-stats` Deno 类型检查及全量 Deno lint 通过。
- 仓库单测：107 个文件、670 项测试全部通过。
- 仓库 ESLint、全仓格式检查、生产构建、许可证/站点元数据/入口资源预算检查和 `git diff --check` 通过；新增相对文档链接有效。
- 构建仍提示已退役 Assistant 路由分块超过 Vite 通用 500 kB 建议值；仓库入口预算检查通过，本次没有修改前端或该模块。

## 生产状态与发布边界

本次冷启动已只读确认 [计划运行 37560581976](https://github.com/greenthree/USTSACMLand/actions/runs/37560581976) 的 6 项洛谷失败均为 HTTP 200、`other_html`、`source_unavailable`，#166 的新增诊断字段为空。6 个最新失败快照题数与此前缓存一致，增量状态未推进；最后成功仍在 2026-09-10，洛谷无 queued/running 残留，队列 cron 健康。这是核对时的状态，不是修复后的生产结果。

生产仍为 `sync-member v65`、`sync-stats v45`。本轮只读下载 `sync-member` 源码至忽略的 `.codex-tmp/luogu-source-audit-20261007/`，逐文件归一化行尾后比较：27 个 TypeScript/JSON 源码文件均与 `be1f594e6a9d9f004b5b093e6d487971794b8bb3`（PR #165）一致；与 `61e245f8` 比较仅洛谷适配器不同。部署源码包含 `responseKind`，不包含 `htmlShape` 或 Lentille 请求头，仍读取旧 envelope。由此确认 #166 的 HTML 结构诊断未部署。

独立生产缺口仍为未应用的 `202609080001_auth_captcha_control.sql`、缺失的 `auth-captcha-config` 和 `SUPABASE_MANAGEMENT_TOKEN`；洛谷 Cookie/CSRF 的 Secret 名称存在，未读取值，不能以存在性证明有效性。

完整 Supabase preflight 未执行：当前脚本在 CAPTCHA 状态缺失时会发送注册 POST，还会发送恶意 Origin/禁用列的安全探针，与 [根操作契约](../../agent.md) 的网络安全请求禁令冲突。本轮只执行项目、migration、函数、Secret 名称和队列的元数据读取，不把它们记为完整 preflight 通过。生产发布继续暂停在门禁处；不修改脚本或跳过要求。

## 发布前只读复核

- `check:ci-workflow`、`check:sync-workflow` 和 `check:backup-workflow` 通过。
- `check:repository-readiness` 退出 1。该工具只读取最近 100 个总 Actions 运行，小时级任务遮挡了此前 CI/Pages/Secret scan，导致三项“尚无成功运行”的报告；按 workflow 定向核对，三者最近一次实际成功均覆盖 `61e245f8`，分别为 [CI 36318581276](https://github.com/greenthree/USTSACMLand/actions/runs/36318581276)、[Pages 36319162314](https://github.com/greenthree/USTSACMLand/actions/runs/36319162314)、[Secret scan 36318581261](https://github.com/greenthree/USTSACMLand/actions/runs/36318581261)。工具本身仍未通过，本任务没有修改检查范围。
- 计划同步失败是真实阻塞。最近三次计划备份也均失败；[最新备份 37531391090](https://github.com/greenthree/USTSACMLand/actions/runs/37531391090) 在读取 Supabase 项目状态时返回 `Unauthorized`，没有进入可确认成功的加密快照交付。未读取或替换 GitHub 的 `SUPABASE_ACCESS_TOKEN`，未重跑备份。
- 最近一次成功备份为北京时间 `2026-09-11 03:10:33` 的 [34518818833](https://github.com/greenthree/USTSACMLand/actions/runs/34518818833)；本轮 artifact 列表为空，不能把该历史成功当成当前可下载恢复材料。没有下载、解密、恢复或触发新备份；备份连续性作为独立发布阻塞登记。
- 本轮范围为提交、推送和草稿 PR，分支 CI 的最终状态以 GitHub 检查为准；不合并、不部署、不改变生产配置或触发同步。

实际同步调用链为 `sync-stats` HTTP 调用 `sync-member`，后者通过 adapters registry 执行洛谷适配器。当前修复的执行消费者是 `sync-member`；`sync-stats` 对 registry 的导入用于平台列表/类型，本身不执行洛谷 transport。后续部署清单应按此调用链和打包结果确认，不自动扩大到全部函数。

本轮继续指令用于推进提交、推送和草稿 PR；合并、部署和一次受控成员的洛谷烟测仍需相应新授权。烟测只覆盖获准成员的一次洛谷同步，随后只读对账统计、增量状态、快照与 freshness，并观察下一次自然日更。不要使用覆盖所有成员的 `scope=platform` 代替单成员烟测。

部署前需明确最终候选提交和与当前 Schema 兼容的回滚范围。已确认的 v65 源码回滚提交为 `be1f594e6a9d9f004b5b093e6d487971794b8bb3`；该版本保留缓存但仍使用旧协议，不作为洛谷恢复版本。回滚仅部署获准的 `sync-member`，不回退 migration，不改 Secret/cron，不清零统计。Git 的基线 SHA 不能代替已部署源码证明。

## 接替记录

```text
任务：核实洛谷 Lentille 记录页协议并完成最小本地修复。
当前分支 / 基线：codex/luogu-lentille-records / 61e245f8d679b45f3bd962d3894194f218201b4c。
已完成：浏览器结构和公开源码核对、transport/parser/fixture 更新、ROADMAP 和脱敏证据记录；v65 源码与 #165 一致性及回滚提交确认。
验证：洛谷 33、平台契约 12、全量 Edge 495（1 ignored）、仓库 670 项通过；类型、格式、lint、生产构建、workflow 静态检查和 diff 检查通过。生产就绪门禁未通过。
生产状态：洛谷事件未闭合；本轮没有生产部署、配置修改或同步触发。
未提交或用户已有改动：任务代码与证据由本轮提交/草稿 PR 交付；原有 maintainer-handoff 入口和 luogu-sync-handoff-2026-10-06.md 保留为未提交改动。
遗留风险：真实 JSON 与生产恢复未验证；Auth 部署缺口、完整 preflight 与网络请求边界冲突、仓库 readiness 和备份认证/连续性阻塞未解决。
下一步：等待草稿 PR 的 CI 到终态，保持生产发布暂停；单独处理发布阻塞后，再批准部署与受控烟测。
需要项目负责人输入或批准：本地阶段无需新增输入；后续发布与生产操作需明确范围和新批准。
```
