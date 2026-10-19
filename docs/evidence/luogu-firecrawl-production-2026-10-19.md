# 洛谷 Firecrawl 定向发布（2026-10-19）

状态：已完成本次批准的定向发布和单成员真实验收。Firecrawl 洛谷认证同步首次尝试成功；全体绑定的恢复仍待下一次自然日更观察。

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

本次证明一个既有绑定能通过真实 Firecrawl 认证抓取、解析并原子提交；不代表全部绑定已经更新。下一次自然日更计划为 2026-10-19 19:00 Asia/Shanghai（11:00 UTC），应核对洛谷全体成功率、保留状态、队列和额度，届时再决定关闭 ROADMAP 的恢复验收项。

Postgres 直连仍有 TLS 超时，现有 HTTPS 管理通道可用。Auth 生产配置缺口和 QOJ 下一次自然周更属于其他待办。未创建正式版本标签，未执行全站 readiness 或网络安全探测。

发布后的结果文档与 ROADMAP 更新单独提交到本任务分支；生产发布仍指向上述 main 合并提交，没有因补充记录再次发布应用。

```text
任务：洛谷获取层改为 Firecrawl 并定向发布。
发布候选分支 / 提交：codex/luogu-lentille-records / c75bebf；main 合并为 6de6968；后续结果记录为独立文档提交。
已完成：全部发布门禁、定向迁移、隐私说明、PR 合并、两个函数源码核对、一次受控同步与对账。
生产状态：77 个 migration；sync-member v67 / sync-stats v47；单成员洛谷 fresh；队列为空。
未提交或用户已有改动：域名、旧交接、readiness 脚本等原有改动保留；本轮结果文档与 ROADMAP 更新独立记录。
遗留风险：全体洛谷绑定的自然日更尚未观察；单成员成功不能替代全体恢复验收。
下一步：核对北京时间 19:00 自然日更的终态与数据新鲜度。
需要项目负责人输入或批准：无；本次范围已批准。
```
