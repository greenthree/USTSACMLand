# 洛谷 Firecrawl 定向发布（2026-10-19）

状态：已完成本次批准的定向发布和单成员真实验收。Firecrawl 洛谷认证同步首次尝试成功，但后续两条任务均遇到接口层 429 且一次自动重试仍失败；洛谷尚未全员恢复。

## 授权与范围

负责人在本会话明确批准本轮提交、推送、合并、仅洛谷迁移、隐私说明、两个同步函数、现有专用洛谷 Cookie/CSRF 传给 Firecrawl，以及一次单成员洛谷同步。首次可恢复失败仍最多执行一次既有持久队列重试，不手工重复触发。

Auth CAPTCHA migration、函数、Secret 和其他平台重跑均不在本次范围。原有工作区改动保留。验证不读取凭据值、浏览器存储或输出成员标识；未执行网络安全探测型 readiness。

## 代码与门禁

- PR：[167](https://github.com/greenthree/USTSACMLand/pull/167)。
- 候选：`c75bebf39be13cd9b761515db51226410fd14fb7`。
- 合并：`6de69680eb3d453c3e366b4a2e9e6d14f8805de9`，2026-10-19 09:16:20 UTC；合并树与候选完全一致。
- PR CI：[39226718082](https://github.com/greenthree/USTSACMLand/actions/runs/39226718082)，verify、database-security 成功。
- PR Secret scan：[39226718086](https://github.com/greenthree/USTSACMLand/actions/runs/39226718086)，成功。
- main CI：[39228803972](https://github.com/greenthree/USTSACMLand/actions/runs/39228803972)，verify、database-security 成功。
- main Secret scan：[39228803939](https://github.com/greenthree/USTSACMLand/actions/runs/39228803939)，成功。
- Pages：[39230573684](https://github.com/greenthree/USTSACMLand/actions/runs/39230573684)，build、deploy、production-ranking-audit 均成功，部署上述合并提交。

本地验证与生产基线隔离测试详见 [发布准备](../luogu-firecrawl-release-2026-10-19.md)。

## 数据库结果

执行前再次核对项目 `qzggoqdmsvktrtnjislw`、76 个历史 migration 的集合摘要，以及既有两个 Key 池函数体摘要，均与已审阅基线一致。5 个 Key 均启用且健康，最小剩余额度为 992；队列调度 configured / active，最近 HTTP 200、无超时或传输错误。

通过已登录 CLI 的 HTTPS Management API，一次执行已审阅事务文件。事务 SHA-256 为 `17e23739aa0c250e4eae75c7f2aea09fe5f73c12e609c9d42acd12df91140e66`；没有重放。

提交后独立只读核对：

- 生产共 **77 个 migration**。
- `202610190001_luogu_firecrawl_key_pool` 真实历史记录 1 条，包含实际 SQL。
- `202609080001_auth_captcha_control` 为 0 条。
- selector 函数体 MD5 为 `0405aeb80ac6c135399a980fb0072f38`，observation 为 `20eb3be96a71d7519acc72127a68d564`，均与仓库精确源码一致。
- assignment purpose 约束包含 `qoj` 和 `luogu`；两个 RPC 仍只允许 service role 执行，anon / authenticated 无执行权限。

没有使用整批 db push 或 migration repair。新 Schema 与旧消费者兼容。

## 函数、隐私与烟测

本次采用“数据库 → Pages 隐私文案 → 两个 Edge 消费者”的顺序，确保新增第三方凭据流向先披露。

内置浏览器确认线上 `/privacy` 更新日期为 2026-10-19，已披露目标 UID、专用洛谷 Cookie/CSRF 发送给 Firecrawl、关闭缓存及供应商保留边界。本地三视口验证见发布准备；生产披露截图保存在忽略目录中，没有凭据或成员信息。

仅部署 `sync-member v67` 和 `sync-stats v47`，均为 ACTIVE、JWT=true、import_map=true。分别下载两个生产 bundle，各 27 个源码文件，与已通过 CI 的候选规范化换行后全部一致。其他函数的版本和更新时间均未变化。旧 `sync-member v66` / `sync-stats v46` 的独立完整回滚包继续保留。

受控 workflow：[39231306024](https://github.com/greenthree/USTSACMLand/actions/runs/39231306024)，使用 main、`scope=member`、`platforms=luogu`，只 dispatch 一次。结果：

- workflow、job、run 均成功，只有洛谷 1 个 run；首次尝试耗时 **27,679 ms**，没有排队重试。
- Key 池存在本次 attempt 的一次领取记录，源码版本为 `luogu-firecrawl-lentille-pb-v6`。
- `platform_stats` 为 `fresh`、error_code 为空、最后成功时间推进；题数与状态内 P/B 去重题目数一致。
- checkpoint 版本、全量校准时间均推进，新增 1 个成功快照；其他平台统计摘要不变。
- 最终 queued/running 为 0；5 个 Key 仍启用且健康。额度字段来自既有监控观察，不把它当成本次抓取的精确账单。

此次成功未触发故障保留路径；该路径由既有本地与 CI 回归覆盖，未额外制造生产故障。生产 run 未保存逐页数量，因此本记录不推断本次页数或精确计费。

## 遗留与交接

### 17:48 限流排查（Asia/Shanghai）

发布后另一次同步在 17:48:07 开始、17:48:51 结束，43,533 ms 后报告 `rate_limited`。只读对账和已部署源码确认：429 发生在 Firecrawl HTTP 请求层，未经过洛谷页面 metadata 的错误分类；旧归一化逻辑把无来源标记的 HTTP 429 统一写成 “Luogu rate limit was reached”。该文字不能证明洛谷网站限流，当前日志也不能区分 Firecrawl 请求配额或并发限制。

原任务进入一次持久队列重试，最早执行时间为 17:50:51；五分钟调度在 17:55:02 领取，17:55:46 再次 429，任务以 2/2 attempts 最终失败。随后一条独立任务成功，另一条 429 任务在 17:55:47 重试、17:56:37 再次 429，亦以 2/2 attempts 终止。没有第三次尝试。

最终只读对账：queued/running 为 0；两条失败任务的最后成功时间、成功题数与全量校准时间均保留，题数与最近成功快照一致。按既有契约会另写携带旧值的失败状态快照，不能把它表述为完全没有新快照。排查期间没有追加同步请求、修改生产 Key 或调整限流配置。

本地最小修复为 Firecrawl HTTP 429 添加明确的服务来源和文案，保持可重试分类、一次请求、Key 冷却及原子保留行为。新增回归先复现旧文案断言失败；修复后洛谷 adapter、Key 池与运行时 adapter 共 55 项测试通过，类型、Deno lint、Prettier 和 diff 检查通过。修改尚未提交或部署，不把文案修复当作限流本身已解决。

本次证明一个既有绑定能通过真实 Firecrawl 认证抓取、解析并原子提交；不代表全部绑定已经更新。下一次自然日更计划为 2026-10-19 19:00 Asia/Shanghai（11:00 UTC），应核对洛谷全体成功率、保留状态、队列和额度，届时再决定关闭 ROADMAP 的恢复验收项。

Postgres 直连仍有 TLS 超时，现有 HTTPS 管理通道可用。Auth 生产配置缺口和 QOJ 下一次自然周更属于其他待办。未创建正式版本标签，未执行全站 readiness 或网络安全探测。

发布后的结果文档与 ROADMAP 更新单独提交到本任务分支；生产发布仍指向上述 main 合并提交，没有因补充记录再次发布应用。

```text
任务：洛谷获取层改为 Firecrawl 并定向发布。
发布候选分支 / 提交：codex/luogu-lentille-records / c75bebf；main 合并为 6de6968；后续结果记录为独立文档提交。
已完成：全部发布门禁、定向迁移、隐私说明、PR 合并、两个函数源码核对、一次受控同步与对账。
生产状态：77 个 migration；sync-member v67 / sync-stats v47；发布验收单成员成功，后续两条任务 429 且重试失败；旧成功值保留，队列为空。
未提交或用户已有改动：域名、旧交接、readiness 脚本等原有改动保留；新增 429 来源修正、回归和文档更新尚未提交/部署。
遗留风险：Firecrawl 接口层 429 的具体并发/配额原因尚无充分日志；洛谷尚未全员恢复。
下一步：针对 Firecrawl 429 获取脱敏供应商原因并核对请求节奏；继续保留自然日更验收项，不手工重复同步。
需要项目负责人输入或批准：无；本次范围已批准。
```
