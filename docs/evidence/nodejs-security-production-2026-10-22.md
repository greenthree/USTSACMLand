# Node.js 22.23.4 生产发布记录

日期：2026-10-22（Asia/Shanghai）。状态：负责人批准的合并、main CI、Pages 发布与发布后验证全部完成。

## 发布范围

- [PR #172](https://github.com/greenthree/USTSACMLand/pull/172)，候选 `dbd7631d574cf20c6eb115982d596095b4fb25d1`，仅 7 个 Node 配置与文档文件。
- 负责人在 PR 全部检查通过后明确批准合并并发布 Pages。通过正常分支规则执行一次 merge，未绕过 required checks。
- 合并时间：北京时间 2026-10-22 09:48:39；main 提交 `7491a9bf62710026bac4d20338bcb61ed746c3c8`。
- 候选和合并提交的 Git tree 均为 `d235b9eddecc01302761fa052012e0c91ee204f1`，部署内容没有额外修改。
- `.nvmrc` 固定 `22.23.4`，根包和锁文件约束为 `>=22.23.4 <23`；应用依赖版本没有改变。未部署 Edge Functions 或 migration，未修改 Secret、业务同步、备份、恢复或遗留功能开关。

## 验证结果

| 阶段             | 运行记录                                                                          | 结果                                               |
| ---------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| PR CI            | [39704663772](https://github.com/greenthree/USTSACMLand/actions/runs/39704663772) | verify / database-security 成功                    |
| PR Secret Scan   | [39704663766](https://github.com/greenthree/USTSACMLand/actions/runs/39704663766) | 成功                                               |
| main CI          | [39707818960](https://github.com/greenthree/USTSACMLand/actions/runs/39707818960) | verify / database-security 成功                    |
| main Secret Scan | [39707819010](https://github.com/greenthree/USTSACMLand/actions/runs/39707819010) | 成功                                               |
| Pages            | [39709339719](https://github.com/greenthree/USTSACMLand/actions/runs/39709339719) | build / deploy / production-ranking-audit 全部成功 |

PR 与 main 的两个 CI 作业、Pages build 和 production-ranking-audit 的日志均明确记录 `node: v22.23.4`。main 通过 670 项单元测试、340 项主要浏览器测试、75 项遗留模块本地模拟测试（沿用既有矩阵跳过 20 项）、510 项 Edge 测试（1 项既有 ignored）、53 个 pgTAP 文件 / 1279 项断言，以及数据库并发、Schema lint、类型、格式、lint、构建、许可证、元数据与资源预算检查。没有为了升级修改测试或跳过规则。

Pages 于北京时间 10:08:13 完成全部作业；production-ranking-audit 的 3 项只读生产榜单复算测试通过。该检查不触发平台抓取或改写成员数据。

## 线上内容与浏览器

下载本次 Pages 的 `github-pages` artifact（ID `12396238568`），检查 287 个安全归档路径后解包到忽略目录。使用已校验的 Node.js 22.23.4 对正式首页与 HTML 引用的 5 个入口 JS/CSS 执行正常 GET，6 个资源全部 HTTP 200，SHA-256 均与该构建产物一致。

- 首页 HTML SHA-256：`cf2ad5b0c12cb64db51ea608522748d3dcaf74566c87a923962b768197962591`。
- 入口 JS：`/assets/index-M_rEt-oK.js`，SHA-256 `2aca6c204ad3382b17332114926b653fb2546aa5583fa7de20dea4489920e149`。
- 发布前后 `check-cloudflare-domain.mjs` 均通过，覆盖正式域名、HTTP/www/旧地址跳转、SPA 深链与 fallback、指纹资源缓存；HTML max-age 为 600 秒，指纹资源 max-age 为 31536000 秒且 immutable，第二次入口请求为 Cloudflare HIT。没有修改 DNS、TLS、缓存规则或执行 Purge。
- 使用负责人指定的内置浏览器打开正式 `/privacy`，标题和正文正常渲染，控制台 error/warn 计数为 0。没有读取浏览器存储、登录凭据或成员私有数据。

本次没有视觉实现变化；浏览器只读渲染核对与完整 CI 浏览器矩阵共同作为回归证据。下载包、日志、归档和逐资源哈希清单仅在主工作区忽略目录 `.codex-tmp/node-security-20261022/`，不进入 Git。

## 遗留事项与回滚

升级准备阶段的 npm 审计为 7 个开发依赖包告警（2 critical、4 high、1 moderate），当次生产依赖审计为 0；Node 升级没有修复这些独立 npm 包告警。详情和修复边界见 [升级记录](./nodejs-security-upgrade-2026-10-22.md)。发布记录推送时 GitHub 提示默认分支有 14 条依赖告警（2 critical、3 high、8 moderate、1 low）；这是不同来源和计数口径，尚未逐项重新评估，不能据旧快照宣称当前依赖告警已清零。一次补充 npm 审计未返回新结果后已停止，不记为通过。系统默认 Node.js `24.15.0` 及 Codex 自带运行时没有替换；本项目验证使用独立的安全修复版本。

备份和恢复工作流的项目脚本均读取已合入 main 的 `.nvmrc`。本轮没有手动触发运维任务，下次自然备份计划为北京时间 2026-10-23 00:30；该任务的实际版本和执行结果待自然运行后核对，不能冒称已验证。没有创建后续提醒或自动监控。

此次没有应用行为变化、数据迁移或函数部署，发布后未发现需要回滚的问题。应用回归应通过正常 Git/Pages 发布流程修复，同时保留安全补丁运行时，不回到已知存在漏洞的 Node 版本。

发布后文档提交只推送到任务分支保存，不再次合入 main 或触发另一轮应用发布。PR 描述同步包含本次精确运行与上线结论。

## 交接

```text
任务：发布 Node.js 22.23.4 安全补丁升级。
当前发布分支 / 候选：codex/nodejs-security-release / dbd7631；生产 main 为 7491a9b。
已完成：PR #172 合并、main CI、Secret Scan、Pages 与发布后榜单复算；线上资源及域名/缓存、内置浏览器验证。
验证：所有批准范围内检查成功，CI 和 Pages 项目脚本明确使用 Node.js 22.23.4。
生产状态：Pages 已发布 main 7491a9b；数据库与 Edge Functions 未改变。
未提交或用户已有改动：主工作区 Node 草稿、域名、旧交接及 readiness 修改保留；发布后记录保存在任务分支。
遗留风险：准备阶段 npm 的 7 个开发包告警及 GitHub 最新 14 条告警待独立核对；系统默认旧 Node；自然备份实际版本待核对。
下一步：单独处理开发依赖告警；自然备份发生后核对版本，不新增主动生产任务。
需要项目负责人输入或批准：无。
```
