# 洛谷逐请求 Key 轮换发布（2026-10-19）

状态：本次获批发布和单成员真实跨页验证已完成。18 次请求轮换使用全部 7 个 Key，首次尝试成功；全体绑定的自然日更仍待观察。

## 范围与代码

负责人在本会话批准逐请求轮换的提交/合并、仅新增 migration、只部署 `sync-member` 和一次单成员洛谷验证。Auth CAPTCHA、`sync-stats` 部署、Key 配置/凭据变更和其他平台重跑不在范围。

- PR：[171](https://github.com/greenthree/USTSACMLand/pull/171)。
- 首个候选：`9448fded5d25bf2803f7afbdac798b24c634520c`；CI `39265411973` 在测试清单数量断言处失败，实际新增 pgTAP 文件未计入旧预期。
- 修正后的候选：`0a82cffffbf02b3547bfd0194126256303abe3d1`；仅更新测试清单为 53 文件 / 1279 断言，原有安全检查保留。
- PR CI：[39265960392](https://github.com/greenthree/USTSACMLand/actions/runs/39265960392)，verify、database-security 全部成功；Secret Scan [39265960216](https://github.com/greenthree/USTSACMLand/actions/runs/39265960216) 成功。
- 合并：`cfe9abb31a5e040b9e0590bdd24db2235cac1e1e`，14:24:27 UTC；源码树与候选完全一致。
- main CI：[39268662818](https://github.com/greenthree/USTSACMLand/actions/runs/39268662818)，verify / database-security 成功；main Secret Scan [39268662778](https://github.com/greenthree/USTSACMLand/actions/runs/39268662778) 成功。
- Pages：[39271148651](https://github.com/greenthree/USTSACMLand/actions/runs/39271148651)，build、deploy、production-ranking-audit 全部成功，部署上述合并提交。内置浏览器再次刷新 `/privacy`，正常渲染且保留第三方数据披露。

## 生产前核对

14:01 UTC：目标项目 `qzggoqdmsvktrtnjislw`，生产 77 个迁移，集合 MD5 `f7f4d2cce1b8bd49e8c1191197dae87e`，旧 selector 源码 MD5 `0405aeb80ac6c135399a980fb0072f38`；Auth CAPTCHA 未应用，洛谷没有 queued/running。

7 个已配置 Key 均已启用且健康，没有冷却，最低剩余额度观察为 982；启用状态的变化发生在本轮执行前，Agent 未改动 Key。队列调度 active / configured，最近 HTTP 200，无超时或传输错误。

`sync-member v67` / `sync-stats v47` 均为 ACTIVE、JWT=true、import_map=true。已重新下载当前 `sync-member v67` 的独立回滚包，27 个源码文件与 main `6de69680eb3d453c3e366b4a2e9e6d14f8805de9` 规范化换行后全部一致。

## 迁移事务准备

使用现有已登录 CLI 的 HTTPS Management API，定向迁移文件位于忽略目录 `.codex-tmp/luogu-rotation-release-20261019/apply-only-rotation.sql`。事务包含基线与函数体 guard、仓库精确 migration、真实迁移历史、源码和 service-only grants 核对；超时或响应不明先只读对账，不重放。

- 源迁移 LF SHA-256：`a552b9fd206dbcfa79b7bb8fe07e912e4db5ebccbfea76e08806ac08c5e66b56`。
- 事务 SHA-256：`ea4e45061dd131c11d6b6f55b674435d2257ea559099db3de40463dfc8839004`。
- 新 selector 源码 MD5：`0e0b7e6ed5d6571449e3ff71790f31fa`。

同一事务已在隔离本地 77 迁移基线验证：提交前注入故障完整回滚；正常执行成为 78 个迁移且 Auth CAPTCHA 仍为 0；重放因基线不符被拒绝，库状态不变。其后 100 项相关 pgTAP 再次通过。该隔离服务已停止，测试材料保留，未对生产执行数据库测试或安全探测。

## 生产执行与验收

按批准方案先等 main CI、Pages 和 production-ranking-audit 成功，再一次执行定向迁移事务；独立只读核对为 **78 个 migration**、`202610190002` 真实历史记录 1 条且保存实际 SQL、Auth CAPTCHA 0 条、新 selector 精确源码匹配、anon/authenticated 无执行权限、service role 有执行权限。没有整批 db push、migration repair 或重复执行。

只部署 `sync-member v68`，ACTIVE、JWT=true、import_map=true；独立下载 27 个源码文件，全部与已通过 CI 的候选一致。与发布前元数据比较，只有 `sync-member` 版本和更新时间变化，`sync-stats v47` 及其余函数保持原版本。

只发送一次 `scope=member, platforms=luogu` workflow，保持既有最多一次持久队列重试。脚本在 dispatch 前写不含成员标识的执行标记，拒绝再次 dispatch。运行时只输出状态、attempt、request claim 数和不同 Key 数，不输出 UUID、UID、Key ID 或凭据。失败时保留成功题数/游标，成功时核对去重集合、快照和其他平台摘要。

受控 workflow：[39271973340](https://github.com/greenthree/USTSACMLand/actions/runs/39271973340)，main 合并提交，14:46:36–14:48:01 UTC，结果为：

- workflow、job、run 均成功；首次 attempt 耗时 **85,861 ms**，没有自动或手工重试。
- **18 个独立请求 claim，使用 7 个不同 Key，相邻请求重复使用 Key 次数为 0，无不可用 claim**。此次实际验证了跨页轮换和循环使用，不仅是单页成功。
- 无 429 或其他错误；统计为 `fresh`，最后成功时间、checkpoint 版本和全量校准时间推进，题数与 P/B 去重状态一致，新增 1 个成功快照。
- 非洛谷 run 为 0，其他平台统计摘要保持一致；洛谷 queued/running 为 0。
- 完成后 7 个 Key 仍启用且健康、没有冷却；队列配置和 cron 正常，最近 HTTP 200，无超时或传输错误。额度监控是观察值，未推断本次精确账单。

此次成功没有覆盖全部绑定或故意触发生产故障；完整失败保留边界继续由本地及 CI 回归覆盖。不把本次成功写成 Firecrawl 永远不会限流，也不将全体恢复验收标为完成。

## 后续记录

发布后文档和 ROADMAP 状态作为独立文档提交保存在任务分支，生产应用仍对应上述 main 合并提交，没有为补充结果再次部署应用。下一次自然日更计划为北京时间 2026-10-20 07:00，应核对全体洛谷成功率、数据新鲜度、Key 健康和队列后再关闭恢复验收项。

```text
任务：获批发布洛谷逐请求 Firecrawl Key 轮换。
发布提交：候选 0a82cff；main 合并 cfe9abb；后续记录为任务分支独立文档提交。
已完成：提交/PR/合并、所有发布门禁、定向迁移、sync-member v68、源码核对、一次受控跨页验证与终态对账。
验证：Edge 510 pass / 1 ignored；相关 pgTAP 100；PR/main CI、Secret Scan、Pages、生产榜单审计均成功；真实 18 请求/7 Key 成功。
生产状态：78 migrations；sync-member v68 / sync-stats v47；受控洛谷 fresh、队列为空。
未提交或用户已有改动：本轮结果文档独立提交；原有域名/维护交接/readiness 改动保留。
遗留风险：全体自然日更未验收；本次成功不证明所有 429 原因均消失。
下一步：核对下一次自然日更的全体结果，本轮获批发布范围已完成。
需要项目负责人输入或批准：无；本轮范围已批准。
```
