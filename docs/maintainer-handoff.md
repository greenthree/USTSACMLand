# Agent 维护交接手册

本文是任何全新上下文 Agent 接手 USTS ACM Land 具体维护任务时的操作手册；根级责任、边界和完成定义以 [`agent.md`](../agent.md) 为准。项目采用 Agent 全程维护模式：Agent 负责日常巡检、代码修复、测试、PR、发布、部署、生产操作、监控和事故处理的完整闭环。项目负责人不执行 Agent 能完成的日常步骤，只提供必要的凭据/MFA/验证码输入、账号持有人操作、法律与产品决定及不可逆高风险批准。项目负责人已明确接受没有第二名真人维护者带来的单点风险；Agent 不取得长期账号、MFA 或 Secret 所有权。

专项原理仍以 [生产运维手册](./operations-runbook.md)、[备份与恢复](./backup-and-recovery.md)、[同步巡检](./sync-alerting.md)、[Cloudflare 自定义域名手册](./custom-domain-cloudflare.md) 和 [正式发布检查单](./release-checklist.md) 为准。发生冲突时，以更具体的专项文档、当前代码和生产只读证据为准，不凭记忆操作。

本文不记录账号、邮箱、Token、Cookie、恢复码、项目数据库 URI、密码或成员资料。所有权限登记只写服务、责任人、Secret 名称、消费者和验证日期；敏感值只保存在供应商 Secret、Vault、GitHub Environment 或项目负责人控制的密码管理器中。

WebChat / AI 学习助手与推荐计划已经退出产品范围。现有代码、migration、函数和私有数据结构保留，生产必须保持关闭。维护 Agent 只负责防止入口或服务被误开启，并维持遗留私有数据的 RLS、注销和备份边界，不进行重开、计奖、视觉模型或付费中转站验收。

## 1. 责任模型与已接受风险

| 角色             | 责任                                                                                                          | 不承担的责任                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 项目负责人       | 持有供应商账号、MFA、恢复材料和密码管理器；提供必要输入；批准不可逆高风险操作；决定许可证、产品范围和风险接受 | 不承担 Agent 可以完成的开发、测试、发布或日常运维执行  |
| 维护 Agent       | 读取仓库与运行手册；检查状态；修改代码；运行测试；形成 PR；监控 CI；部署、运维并留下脱敏记录                  | 不持有长期凭据，不自行扩大任务范围，不代表独立真人复核 |
| 冷启动复核 Agent | 在不继承旧会话推理的情况下，仅依靠仓库文档复核计划、命令、证据和清理结果                                      | 不替代项目负责人批准，不通过共享上下文“假装独立”       |

项目负责人接受以下风险：

- 账号恢复、域名续费、供应商申诉和法律责任仍集中在一人；Agent 无法在负责人完全失联时恢复这些能力。
- Agent 的独立性只用于验证文档是否足够清晰，不能证明第二名真人能够接管 MFA、付款方式或实名域名。
- 单人批准降低了双人复核强度，因此所有生产写操作必须更依赖最小权限、可回滚方案、数据库约束、CI 门禁和脱敏证据。

若未来增加真人维护者，可在不改变操作卡的前提下恢复双人复核；在此之前，ROADMAP 不再要求第二名真人签署。

## 2. 给新 Agent 的启动提示

新会话可直接使用以下提示，后接具体任务：

```text
你正在维护 USTSACMLand。先完整阅读 docs/maintainer-handoff.md，再按其中的冷启动检查执行。
项目采用 Agent 全程维护模式：Agent 完成所有可通过工具执行的工作；项目负责人仅保留账号、MFA、Secret 输入及法律/产品和不可逆高风险决定。
不要读取或回显密码、Token、Cookie、浏览器存储或成员私有数据；不要提交 .claude、临时截图、导出文件和备份 Artifact。
默认先做只读诊断。代码修改、提交、推送、合并、部署和生产操作分别以用户本轮明确授权为边界，不能从“维护”一词推导全部权限。
WebChat 和推荐计划保持关闭，不进行重开开发或生产验收。
开始时报告：当前分支、工作树状态、远端默认分支、最近 CI/Pages 状态、生产基线、计划和需要项目负责人批准的操作。

本次任务：<填写任务>
```

## 3. 授权等级

### A. 可直接执行的只读操作

- 阅读仓库代码、文档、migration 和测试；检查 `git status`、diff、提交历史和分支关系。
- 查看 GitHub PR、Actions、Pages、Supabase migration/function 列表和后台健康状态。
- 运行不修改生产数据的本地测试、构建、lint、格式检查和只读就绪检查。
- 检查公开页面、公开 API 和当前页面 UI；不得检查浏览器 Cookie、Local Storage、密码或会话存储。
- 形成诊断、修复建议、回滚计划和脱敏证据草稿。

### B. 需要任务本身明确授权的仓库写操作

- 修改代码、测试和文档。
- 创建 migration 或 Edge Function 变更，但不自动部署到生产。
- 提交和推送；只有用户明确要求“部署、发布或合并”时才可合入 `main` 并等待 Pages。
- 只暂存任务范围内的文件；工作树混杂时逐文件暂存，不使用无差别 `git add -A`。

### C. 每次都要项目负责人明确批准的生产操作

- 应用生产 migration、部署 Edge Function、修改 Function Secret、Vault、Auth、RLS 或 cron。
- 修改 Cloudflare DNS/TLS/缓存规则、执行大范围 Purge、切换 Pages 自定义域名或做流量回滚。
- 触发或下载加密备份、运行隔离恢复、修改恢复下限。
- 轮换 Cookie、CSRF、API Key、密码、队列 Token、备份口令或注销恢复 Token。
- 提升/降级管理员、手工修改成员生产数据、批量同步、注销账号或删除 Storage 对象。
- 创建正式版本标签、回滚生产版本或执行可能产生费用的第三方操作。

批准只覆盖说明过的目标、范围和一次执行，不自动扩展到其他服务或后续批次。若操作结果不确定，先只读对账，不重复点击或重放写请求。

### D. 禁止操作

- 回显、复制到聊天、写入 Git 或日志的任何 Secret、Cookie、JWT、密码、恢复码或完整第三方响应。
- 绕过分支保护、Environment 审批、RLS、速率限制、MFA、验证码或供应商反自动化保护。
- 为了“验证安全”进行爆破、请求洪泛、刻意触发第三方封禁或未被项目负责人单独批准的网络安全测试。
- 强推默认分支、删除 migration、重写已部署历史、执行 `git reset --hard` 或用整库恢复替代可行的前向修复。
- 把 WebChat、图片输入或推荐计划重新开启，除非项目负责人未来明确重新立项。

## 4. 冷启动检查

Agent 在任何写操作前完成以下步骤：

1. 完整阅读本文和与任务直接相关的专项手册。
2. 检查 `git status -sb`、当前分支、远端、最近提交和未跟踪文件；用户已有修改不得覆盖。
3. 检查 GitHub 登录、仓库默认分支、PR、CI、Secret Scan 和 Pages 最近状态。
4. 检查任务是否涉及生产 Supabase、Cloudflare、Firecrawl、QOJ/洛谷账号或成员隐私；涉及则列出需要批准的操作。
5. 先运行只读或本地验证，形成明确计划；不要以旧会话摘要替代当前代码和生产状态。
6. 任务结束时报告提交、PR、部署 ID、验证结果、遗留风险、临时文件和夹具清理情况。

基础命令：

```powershell
git status -sb
git remote -v
gh auth status
gh repo view greenthree/USTSACMLand --json nameWithOwner,defaultBranchRef
gh run list --repo greenthree/USTSACMLand --branch main --limit 8
npx --yes supabase@2.109.1 projects list
npm run check:repository-readiness -- greenthree/USTSACMLand
npm run check:supabase-preflight
```

Supabase CLI 必须只显示一个 linked 项目，且项目引用与仓库生产配置一致。严格检查出现已知阻塞时，Agent 仍须区分“已有风险”与“本次新增回归”，不能为了得到绿色结果修改生产安全配置。

## 5. 权限与 Secret 登记

项目负责人保留下表中的长期权限。Agent 只使用当前任务已经提供的 CLI、浏览器登录态或临时授权，不建立自己的永久账号，不读取 Secret 原值。

| 服务                    | 权威位置与最小权限               | Agent 使用方式                          | 高风险批准                    | 复核周期     |
| ----------------------- | -------------------------------- | --------------------------------------- | ----------------------------- | ------------ |
| GitHub 仓库             | 项目负责人账号；PR/Actions/Pages | 已登录 `gh` 或受控浏览器                | 合并、发布、标签              | 每季度       |
| `production-operations` | GitHub Environment；仅默认分支   | Actions 中引用，不下载 Secret           | 所有生产工作流                | 每季度       |
| Supabase                | 目标项目；数据库与 Function 管理 | linked CLI、Dashboard 或受控脚本        | migration、函数、Secret、Auth | 每季度       |
| Cloudflare              | DNS、TLS、缓存和 Purge           | 受控浏览器或最小权限 API                | DNS、TLS、规则、Purge         | 每季度       |
| 阿里云域名              | 续费、实名与应急控制             | Agent 操作控制台；负责人仅输入实名/付款 | 全部写操作                    | 到期前 60 天 |
| Firecrawl               | Key 池与额度                     | 管理后台或供应商只读用量                | Key 变更与付费操作            | 每季度       |
| QOJ/洛谷账号            | 供应商账号与 Supabase Secret     | 只通过现有函数或受控登录烟测            | 密码、Cookie、CSRF 轮换       | 每季度       |
| 密码管理器              | 备份口令与恢复材料               | Agent 不读取；由负责人输入对应控制台    | 全部访问                      | 每季度       |

必须确认：

- `SUPABASE_PROJECT_REF` 和 `SUPABASE_SERVICE_ROLE_KEY` 只存在于 `production-operations` Environment，不创建仓库级或组织级副本。
- GitHub、Supabase、Cloudflare、阿里云和密码管理器启用 MFA；恢复责任由项目负责人承担。
- Secret 名称、消费者和最近轮换日期可以记录，值、摘要和截图不能记录。

## 6. 同步巡检操作卡

### 频率

- 每个工作日检查后台“同步中心”和“数据源健康”。
- 每周检查仓库 Actions、Supabase 队列和 cron。
- 计划同步、队列或凭据错误持续两个调度周期时建立事件记录；不要等到榜单显示为 0。

```powershell
npm run check:repository-readiness -- greenthree/USTSACMLand
npm run check:supabase-readiness
gh run list --repo greenthree/USTSACMLand --workflow sync-stats.yml --branch main --limit 10
```

只有数据库队列 cron 故障、已确认没有正常 worker 正在处理且项目负责人批准时，才运行：

```powershell
gh workflow run sync-stats.yml --repo greenthree/USTSACMLand --ref main -f scope=queue
```

通过条件：

- 日更计划最近一次成功距今小于 14 小时；
- 数据库队列最近调度和完成响应距今均小于 12 分钟；
- 最近队列 HTTP 为 2xx，近 15 分钟至少一次 cron 成功；
- 没有长期停留的 `queued` / `running`；
- 失败平台保留最后成功值，不能写成 0；
- 可恢复错误最多重试一次，凭据、结构、权限和校验错误不重试；
- 事件只有在后续批次成功、freshness 恢复且无残留任务后才能关闭。

平台定位顺序和增量规则见 [同步巡检](./sync-alerting.md) 与 [生产运维手册](./operations-runbook.md)。只修复并重试受影响平台，不批量重复同步其他平台。

## 7. 加密备份与隔离恢复操作卡

触发备份和恢复前必须取得项目负责人批准。Artifact 只允许保存在仓库忽略的 `.artifacts/`，不得在共享目录解密或提交到 Git。

### 手动加密备份

```powershell
gh workflow run database-backup.yml --repo greenthree/USTSACMLand --ref main
$backupRunId = gh run list --repo greenthree/USTSACMLand --workflow database-backup.yml --branch main --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $backupRunId --repo greenthree/USTSACMLand --exit-status
New-Item -ItemType Directory -Force ".artifacts\backup-$backupRunId" | Out-Null
gh run download $backupRunId --repo greenthree/USTSACMLand --dir ".artifacts\backup-$backupRunId"
```

下载目录只能包含工作流发布的加密文件和校验文件。Agent 不索取解密口令；恢复工作流通过 Environment Secret 使用口令。

### 隔离恢复演练

```powershell
gh workflow run database-restore-drill.yml --repo greenthree/USTSACMLand --ref main -f backup_run_id=$backupRunId
$restoreRunId = gh run list --repo greenthree/USTSACMLand --workflow database-restore-drill.yml --branch main --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $restoreRunId --repo greenthree/USTSACMLand --exit-status
New-Item -ItemType Directory -Force ".artifacts\restore-$restoreRunId" | Out-Null
gh run download $restoreRunId --repo greenthree/USTSACMLand --dir ".artifacts\restore-$restoreRunId"
```

记录只包含 backup/restore run ID、源 SHA、Schema 版本、聚合行数、孤儿计数、Storage 数量/字节/集合哈希、RPO、RTO 和清理确认。不得保存 SQL、成员数据、对象内容、口令或 Secret。

## 8. 凭据轮换操作卡

固定顺序：创建新值 → 更新全部消费者 → 受控烟测 → 确认回滚值仍可用 → 撤销旧值。不得先撤销旧值。

| 凭据                  | 权威存储与消费者                            | 烟测                                               | 回滚边界                                |
| --------------------- | ------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| Firecrawl Key         | 管理后台 Vault Key 池；环境变量只作兼容回退 | 逐 Key 健康/额度、牛客回退、QOJ 会话清理           | 新 Key 健康后禁用旧 Key，再由供应商撤销 |
| QOJ 密码              | QOJ 与 Supabase Function Secret             | 一次目标主页匹配与临时会话关闭                     | 新密码失败立即恢复旧 Secret             |
| 洛谷 Cookie/CSRF      | Supabase Function Secrets，成对更新         | UID、P/B Accepted 增量同步                         | 任一失败时成对恢复                      |
| `SYNC_QUEUE_TOKEN`    | Supabase Function Secret 与 Vault           | 更新两处后手动调用及下一次 cron 2xx                | 两处未一致前不恢复 cron                 |
| Supabase service role | GitHub Environment 和必要服务端消费者       | 同步、生产安全检查、前端分块无泄露                 | 所有消费者通过后撤销旧值                |
| 备份加密口令          | GitHub Environment Secret 与密码管理器      | 新备份和隔离恢复                                   | 旧 Artifact 到期前保留对应旧口令        |
| 注销恢复 GitHub Token | Supabase Function Secret                    | `check:recovery-token`、受控注销、恢复下限单调前移 | 新 Token 验收后撤销旧 Token             |

Agent 只记录项目负责人批准时间、消费者清单、烟测、撤销时间和回滚判断，不记录值或摘要。若控制台要求输入新值，由项目负责人输入；Agent 可以继续完成其余页面操作和验证。

## 9. 发布与回滚操作卡

### 常规发布

1. 明确发布范围，逐文件暂存，排除用户本地配置和临时产物。
2. 运行相关测试、全仓库 lint/format、生产构建和 `git diff --check`。
3. 推送 `codex/*` 分支，创建 PR；等待 `verify`、`database-security` 和 `gitleaks`。
4. 只有项目负责人明确要求部署时才合并到 `main`。
5. 等待 `main` CI 成功后触发 `Deploy GitHub Pages`，确认 build、deploy 和 `production-ranking-audit` 全部成功。
6. 记录 PR、合并 SHA、CI run、Pages run 和正式地址，不把日志中的敏感数据复制进记录。

### 前端回滚

1. 记录故障 SHA、最后正常 SHA 和当前 Pages deployment URL。
2. 使用 `git revert` 创建 PR，不强推、不重写历史。
3. 等待全部 CI 与 Pages 部署通过。
4. 验证首页、深链、登录、账号页和后台；确认遗留 WebChat 与推荐计划入口仍关闭。
5. 只有项目负责人批准时才 Purge 必要 HTML/路径，不清除指纹静态资源的长期缓存。

### Edge Function 回滚

旧函数必须与当前 Schema 兼容。使用临时 worktree，只部署受影响函数；数据库 migration 不回写、不删除，使用 corrective migration。遗留 WebChat 函数不随常规回滚部署，除非是关闭态安全或 Schema 兼容修复。

```powershell
git worktree add ..\ustsacmland-rollback <known-good-commit>
Set-Location ..\ustsacmland-rollback
npx --yes supabase@2.109.1 functions deploy sync-member sync-stats sync-avatar member-avatar delete-account change-password firecrawl-config --use-api --import-map supabase/functions/deno.json
npm run check:supabase-readiness
```

## 10. 管理员、账号与外部权限

Agent 不创建专用站内管理员账号，也不保存项目负责人的登录信息。需要后台操作时，使用项目负责人已登录的受控浏览器会话；不得读取 Cookie、Local Storage、密码或恢复码。

角色变更遵循：目标成员正常注册并验证 → Agent 核对目标且项目负责人批准角色变更 → Agent 在后台填写原因并二次确认 → 目标管理员完成必须由本人进行的登录 → Agent 继续只读验证并执行一次低风险审计操作 → 确认可用后再由 Agent 降级旧管理员。数据库必须始终保留至少一名启用管理员。

外部权限仍由项目负责人长期持有，包括 GitHub、Supabase、Cloudflare、阿里云域名、Firecrawl、密码管理器、QOJ/洛谷服务账号和备份口令。Agent 只通过当前已授权会话执行任务，不拥有这些权限。

首管理员 bootstrap 只适用于数据库完全没有管理员的首次部署，不能用于失联恢复。单人维护模式下的 break-glass 操作必须由项目负责人在本次会话明确批准，并记录原因、时间、临时权限、验证和撤销结果。

## 11. 事件优先级与停止条件

优先级：账号/数据泄露风险 → Auth/RLS/注销不一致 → 数据库或 Pages 不可用 → 同步队列停滞 → 单平台失败 → UI 缺陷。

出现以下情况时 Agent 必须停止写操作并请求项目负责人决定：

- 生产目标、账号或分支与文档不一致；
- 工作树中存在无法判定归属的用户修改；
- 需要新的供应商权限、付款、MFA、实名操作或 Secret 原值；
- 回滚会导致数据丢失、Schema 不兼容或流量路径变化；
- 写请求结果不确定，无法通过只读状态精确对账；
- 同一阻塞连续三轮仍无法消除。

失败时优先保持服务关闭、保留最后成功数据、停止扩大变更范围。不要为了让检查变绿而削弱 RLS、关闭验证码、放宽 CORS、增加无限重试或把失败值写成 0。

## 12. Agent 交接记录模板

```text
日期与时区：
执行 Agent / 会话：不记录账号标识
项目负责人批准范围：
任务目标：
起始分支与提交：
目标生产提交：

[ ] 已完整阅读 maintainer-handoff 和任务专项文档
[ ] 已核对工作树、远端、CI、Pages 和 linked Supabase 项目
[ ] 未读取或回显 Secret、Cookie、JWT、密码和成员私有数据
[ ] 已列出并取得本次生产写操作的明确批准
[ ] 本地测试、CI、部署或只读检查已记录
[ ] 写请求不确定时先完成只读对账，没有盲目重试
[ ] 临时分支、worktree、Artifact、截图和测试夹具已清理或明确保留原因
[ ] WebChat 与推荐计划继续保持关闭

代码提交 / PR：
CI run：
Pages / Supabase run：
生产验证：
遗留风险与下一步：
需要项目负责人决定的事项：
```

## 13. 冷启动可执行性验收

交接文档的完成标准不再要求第二名真人。满足以下条件即可认为 Agent 交接可用：

1. 一个不继承维护会话推理的 Agent 仅根据仓库文档完成冷启动检查；
2. 它能正确区分只读、本地写、发布和生产高风险授权；
3. 它至少完成一次同步巡检和一次发布/回滚桌面推演；
4. 备份、恢复和凭据轮换可以只读核对命令与消费者，不要求无业务需要地真实轮换；
5. 输出使用本节模板，且不含 Secret、成员资料或浏览器存储；
6. 项目负责人确认文档足以让后续 Agent 继续执行。

这项验收只证明操作文档可被 Agent 使用。账号恢复、MFA、域名续费和供应商申诉仍是项目负责人承担的单人风险。

2026-08-09 已由全新上下文 Agent 完成首次冷启动可执行性验收：GitHub、Supabase、同步队列和备份连续性只读核对通过，发布与四类回滚完成桌面推演，没有触发生产写操作。验收同时发现并修复仓库级 Secret 与 `production-operations` Environment Secret 的检查口径偏差；完整脱敏记录见 [`docs/evidence/agent-cold-start-handoff-audit-2026-08-09.md`](./evidence/agent-cold-start-handoff-audit-2026-08-09.md)。
