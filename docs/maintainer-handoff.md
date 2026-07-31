# 维护者交接与独立操作卡

本文是新维护者接手 USTS ACM Land 的单一入口。专项原理仍以
[生产运维手册](./operations-runbook.md)、[备份与恢复](./backup-and-recovery.md)、
[同步巡检](./sync-alerting.md) 和 [正式发布检查单](./release-checklist.md) 为准。

本文不记录账号、邮箱、Token、Cookie、恢复码、项目数据库 URI 或成员资料。所有权限
登记只写服务、角色、负责人和验证日期；敏感值只保存在组织批准的密码管理器或对应服务
Secret 中。

WebChat / AI 学习助手与推荐计划已退出产品范围。现有代码、migration、函数和私有数据结构保留，但生产必须保持关闭；本操作卡不再要求中转站、图片、邀请码、奖励或重开演练。维护者只需防止入口或服务被误开启，并维持遗留私有数据的 RLS、注销和备份边界。

## 完成标准

ROADMAP 的“其他维护者可执行”条目只有在一名非原维护者独立完成并记录以下六项后才可
勾选：

1. 一次同步状态巡检；
2. 一次手动加密备份；
3. 一次使用该备份的隔离恢复演练；
4. 一次不更换真实 Secret 的凭据轮换桌面演练，或一次明确批准的低风险真实轮换；
5. 一次前端与 Edge Function 回滚桌面演练；
6. 一次站内管理员和外部维护权限交接。

自动化测试只能证明工具链，不替代供应商权限、MFA、密码管理器和人员交接。

## 1. 权限登记

在私有维护记录中填写下表。不要把账号标识或恢复方式提交到 Git。

| 服务                           | 最小权限                                                   | 主要负责人 | 替补负责人 | MFA/恢复责任人 | 最近验证 | 到期/复核日  |
| ------------------------------ | ---------------------------------------------------------- | ---------- | ---------- | -------------- | -------- | ------------ |
| GitHub 仓库                    | 读取代码与 Actions；发布者另需写入分支/PR 和手动运行工作流 | 待登记     | 待登记     | 待登记         | 待验证   | 每季度       |
| GitHub `production-operations` | 审批备份、恢复和生产运维任务                               | 待登记     | 待登记     | 待登记         | 待验证   | 每季度       |
| Supabase                       | 目标项目开发者；数据库/Secret 变更仅限授权维护者           | 待登记     | 待登记     | 待登记         | 待验证   | 每季度       |
| Cloudflare                     | DNS、TLS、缓存规则和 Purge 权限                            | 待登记     | 待登记     | 待登记         | 待验证   | 每季度       |
| 阿里云域名                     | 域名续费、实名信息和 DNS 应急切回权限                      | 待登记     | 待登记     | 待登记         | 待验证   | 到期前 60 天 |
| Firecrawl                      | Key 池额度与轮换权限                                       | 待登记     | 待登记     | 待登记         | 待验证   | 每季度       |
| QOJ/洛谷服务账号               | 登录与凭据轮换                                             | 待登记     | 待登记     | 待登记         | 待验证   | 每季度       |
| 密码管理器                     | 备份口令及恢复材料条目访问                                 | 待登记     | 待登记     | 待登记         | 待验证   | 每季度       |

新维护者先执行只读准入检查：

```powershell
gh auth status
gh repo view greenthree/USTSACMLand --json nameWithOwner,defaultBranchRef
gh workflow list --repo greenthree/USTSACMLand
npx --yes supabase@2.109.1 projects list
npm run check:repository-readiness -- greenthree/USTSACMLand
npm run check:supabase-readiness
```

Supabase 命令必须只显示一个 `linked` 项目，且项目引用必须是仓库当前生产配置。严格
Supabase 检查可能因 ROADMAP 已知的 Auth/CAPTCHA 配置返回阻塞；新维护者仍须确认
migration、十个函数、Function Secret 名称、匿名 REST、函数边界和同步调度结果没有新增
故障。

以下能力必须在服务控制台中人工验证并记录，仓库脚本不能代替：

- 谁能批准 `production-operations`；
- `production-operations` 仅允许默认分支部署，`SUPABASE_PROJECT_REF` 与
  `SUPABASE_SERVICE_ROLE_KEY` 只保存为该 Environment 的 Secret，仓库级或组织级同名
  Secret 副本已经删除；
- 谁能手动运行 Actions 和下载 Artifact；
- 谁能读取备份解密口令；
- 谁能修改 Supabase Auth、Function Secrets 和数据库；
- 谁能执行 Cloudflare Purge、DNS 回滚和域名续费；
- GitHub、Supabase、Cloudflare、阿里云和密码管理器均启用 MFA，且至少一名替补人可恢复。

## 2. 同步巡检操作卡

### 频率与责任

- 每个工作日检查后台“同步中心”和“数据源健康”。
- 每周执行一次仓库和 Supabase 只读检查。
- 计划同步、队列或凭据错误持续两个调度周期时建立事件记录；不要等到榜单显示为 0。
- 值班人保存观察时间、脱敏 Actions URL、平台、聚合状态、处置和关闭人。

### 命令

```powershell
npm run check:repository-readiness -- greenthree/USTSACMLand
npm run check:supabase-readiness
gh run list --repo greenthree/USTSACMLand --workflow sync-stats.yml --branch main --limit 10
```

只有数据库队列 cron 故障且已确认没有正常 worker 正在处理时，才使用手动应急入口：

```powershell
gh workflow run sync-stats.yml --repo greenthree/USTSACMLand --ref main -f scope=queue
```

`sync-stats.yml` 的计划任务和手动任务都只能在正式仓库默认分支运行，并通过
`production-operations` 读取生产 Supabase Secret。不要为了让分支任务通过而重新创建
仓库级或组织级 `SUPABASE_SERVICE_ROLE_KEY`；否则分支工作流可绕过 Environment 边界。

### 通过条件

- 计划同步最近一次成功距今小于 14 小时；
- 数据库队列最近调度和最近完成响应距今均小于 12 分钟；
- 最近队列 HTTP 为 2xx，近 15 分钟至少一次 cron 成功；
- 没有长期停留的 `queued` / `running` 任务；
- 平台数据是否过期以各行 `stale_after` 为准，不以页面访问时间猜测；
- 最终失败保留最后成功值，不能被写成 0；
- 凭据、结构变化和权限错误不进入自动重试；可恢复错误最多一次重试。

事件只有在任务进入终态、后续计划批次成功、数据 freshness 恢复且没有残留队列后才能关闭。

## 3. 手动备份与恢复演练

需要仓库 Actions 运行权限、`production-operations` 审批、Artifact 读取权限，以及密码
管理器中备份口令的受控访问。口令不得进入 PowerShell 历史或下载目录名称。

### 触发并取得备份

```powershell
gh workflow run database-backup.yml --repo greenthree/USTSACMLand --ref main
$backupRunId = gh run list --repo greenthree/USTSACMLand --workflow database-backup.yml --branch main --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $backupRunId --repo greenthree/USTSACMLand --exit-status
New-Item -ItemType Directory -Force ".artifacts\backup-$backupRunId" | Out-Null
gh run download $backupRunId --repo greenthree/USTSACMLand --dir ".artifacts\backup-$backupRunId"
```

下载目录只能包含工作流发布的加密文件和校验文件。不要在共享目录解密，不要把 Artifact
提交到 Git。

### 触发隔离恢复演练

```powershell
gh workflow run database-restore-drill.yml --repo greenthree/USTSACMLand --ref main -f backup_run_id=$backupRunId
$restoreRunId = gh run list --repo greenthree/USTSACMLand --workflow database-restore-drill.yml --branch main --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $restoreRunId --repo greenthree/USTSACMLand --exit-status
New-Item -ItemType Directory -Force ".artifacts\restore-$restoreRunId" | Out-Null
gh run download $restoreRunId --repo greenthree/USTSACMLand --dir ".artifacts\restore-$restoreRunId"
```

验收记录只保存：backup/restore run ID、源 SHA、Schema 版本、8 项聚合行数、孤儿关系
计数、Storage 对象数量/字节/集合哈希、Auth/RLS/注销烟测、RPO、RTO 和明文清理确认。
不得保存 SQL、成员数据、对象内容、口令或 Secret。

图片正式开放前还必须完成一次 Schema v2 **非空图片对象**恢复演练；零对象恢复不能替代。

## 4. 凭据轮换操作卡

通用顺序固定为：创建新值 → 更新所有消费者 → 受控烟测 → 确认回滚值仍可用 → 撤销旧值。
不得先撤销旧值。

| 凭据                    | 权威存储与消费者                                                             | 烟测                                                   | 回滚/撤销边界                                           |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Firecrawl Key           | 管理后台私有 Vault Key 池；`FIRECRAWL_API_KEY` 仅是无数据库 Key 时的兼容回退 | 逐 Key 健康/额度、牛客回退、QOJ 临时会话清理           | 新 Key 健康后禁用旧 Key，再由供应商撤销                 |
| QOJ 密码                | QOJ 与 Supabase Function Secret                                              | 一次目标主页匹配；确认临时会话关闭                     | 新密码失败立即恢复旧 Secret，未验证前不撤销旧密码       |
| 洛谷 Cookie/CSRF        | Supabase Function Secrets，成对更新                                          | UID 校验、P/B Accepted 增量同步                        | 任一项失败时成对恢复                                    |
| 同步队列 Token          | Supabase Function Secret 与 Vault                                            | 暂停 cron、更新两处、手动调用和下一次 cron 2xx         | 两处未一致前不恢复 cron                                 |
| Supabase service role   | GitHub/Supabase 受控 Secret 消费者                                           | 同步、生产安全检查；浏览器分块无泄露                   | 所有消费者切换并通过后撤销旧值                          |
| 遗留 WebChat 中转站 Key | Supabase Vault；不再复制到 GitHub 或前端                                     | 确认数据库、函数和前端入口均关闭                       | 无业务依赖后按批准流程删除；保留期间继续防止读取和回显  |
| 备份加密口令            | GitHub Environment Secret 与密码管理器                                       | 新备份 + 恢复演练                                      | 14 天内旧 Artifact 的旧口令必须保留到对应 Artifact 到期 |
| 注销恢复 GitHub Token   | Supabase Function Secret                                                     | `npm run check:recovery-token`、受控注销和变量单调前移 | 新 Token 验收完成后撤销旧 Token；不得降低恢复下限       |

真实轮换必须记录变更人、第二复核人、消费者清单、烟测结果、旧值撤销时间和回滚判断，
但不记录任何值或摘要。

## 5. 回滚桌面演练

### 前端

1. 记录故障提交、最后正常 SHA 和当前 Pages deployment URL。
2. 使用 Git revert 创建 PR，不强推、不重写历史。
3. 等待 `verify`、`database-security`、`gitleaks` 和 Pages 部署通过。
4. 验证首页、深链、登录、账号页和后台入口，并确认遗留 AI 助手与推荐计划入口不可见。
5. Cloudflare 只 Purge HTML/必要路径，不清除指纹静态资源的长期缓存；保存脱敏 Purge 记录。

### Edge Functions

只有旧函数与当前 Schema 兼容时才重新部署。临时 worktree 中只部署受影响函数：

```powershell
git worktree add ..\ustsacmland-rollback <known-good-commit>
Set-Location ..\ustsacmland-rollback
npx --yes supabase@2.109.1 functions deploy sync-member sync-stats delete-account change-password firecrawl-config --use-api --import-map supabase/functions/deno.json
npm run check:supabase-readiness
```

记录回滚前后业务函数版本。遗留 WebChat 函数不随常规回滚重新部署；只有关闭态安全修复或 Schema 兼容确有需要时才从当前主分支部署，并在部署后复核全部开关仍关闭。若旧函数不兼容当前 Schema，只能从主分支发布前向修复。

数据库 migration 不回写、不删除；已部署问题使用 corrective migration。整库恢复必须先通过
`BACKUP_RECOVERY_NOT_BEFORE`，并在隔离环境验证 Auth、RLS、8 项行数、孤儿关系和非空
Storage 对象。

## 6. 管理员与维护权交接

### 站内管理员

1. 新管理员正常注册，验证密码找回和资料。
2. 现任管理员在成员管理中提升角色，填写原因并二次确认。
3. 新管理员只读打开成员、同步、审计、Firecrawl 和遗留 WebChat 配置页，确认 WebChat 与推荐计划保持关闭且这些入口只对管理员可见。
4. 执行一项可撤销、低风险且有审计的操作，例如修改后立即恢复一条测试公告草稿。
5. 运行 `npm run check:production-security` 验证角色变化、旧 JWT 和跨成员边界。
6. 确认新管理员可用后再降级离任管理员；数据库必须拒绝移除最后一名启用管理员。

### 外部维护权

逐项转交或撤销 GitHub、`production-operations`、Supabase、Cloudflare、阿里云域名、
Firecrawl、密码管理器、QOJ/洛谷服务账号和备份口令访问。站内角色交接不能替代这些权限。

首管理员 bootstrap 只适用于数据库中完全没有管理员的首次部署，不能作为管理员失联恢复
方案。break-glass 恢复必须由两名维护者批准，在私有事件记录中写明原因、时间、临时权限
和撤销确认。

## 7. 脱敏交接记录模板

```text
日期：
接任维护者：内部登记，不提交账号标识
复核人：
目标提交：

[ ] 权限准入与 MFA/恢复责任人已核对
[ ] 同步巡检已独立完成，事件关闭条件可解释
[ ] 手动备份成功，run ID：
[ ] 隔离恢复演练成功，run ID：
[ ] 凭据轮换桌面/真实演练完成
[ ] 前端和 Edge 回滚桌面演练完成
[ ] 站内管理员与外部维护权限交接完成
[ ] 所有临时权限、Artifact 明文和测试夹具已清理

发现的问题与修复：
ROADMAP 是否可勾选：否 / 是（必须有第二复核人）
```
