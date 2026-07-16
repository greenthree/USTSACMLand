# 正式发布检查单

本检查单用于 USTS ACM Land 的候选版本、正式版本和紧急修复发布。每次发布复制一份到变更记录中填写，不在仓库中记录密码、Token、Cookie、成员私有资料或第三方原始响应。

## 1. 发布范围与责任人

- [ ] 已记录版本号、候选提交、变更摘要、发布人和复核人。
- [ ] 工作树只包含本次发布内容；临时截图、导出文件和根目录本地素材未被误纳入。
- [ ] 数据库、Edge Functions、前端和配置的兼容顺序已明确。
- [ ] 已记录最后一个可用的 Git 提交、Pages 部署和 Supabase migration 状态。

## 2. 本地与 CI 门禁

- [ ] Node.js 版本符合 `.nvmrc`，使用 `npm ci` 安装锁定依赖。
- [ ] 以下命令全部通过：

  ```powershell
  npm run format:check
  npm run lint
  npm run check:ci-workflow
  npm run check:sync-workflow
  npm run check:backup-workflow
  npm run check:repository-readiness -- greenthree/USTSACMLand
  npm run check:supabase-preflight
  npm test
  npx playwright install chromium firefox webkit
  npm run test:e2e
  npm run build
  npm run check:bundle
  npx --yes deno check --config supabase/functions/deno.json supabase/functions/sync-member/index.ts supabase/functions/sync-stats/index.ts supabase/functions/delete-account/index.ts supabase/functions/change-password/index.ts
  npx --yes deno lint --config supabase/functions/deno.json supabase/functions
  npx --yes deno test --allow-read --allow-env --config supabase/functions/deno.json supabase/functions
  git diff --check
  ```

- [ ] GitHub `CI / verify`、`CI / database-security`、`Secret scan / gitleaks` 和部署后的 `production-ranking-audit` 全部通过。
- [ ] Dependabot 没有尚未评估的高危更新；依赖升级已由测试和构建验证。
- [ ] 构建日志、测试输出和 Actions artifact 不含 Secret 或成员私有资料。
- [ ] `Encrypted database backup` 最近一次手动任务成功，Artifact 只包含 `.enc` 和 `.enc.sha256`。

## 3. 数据库与权限

- [ ] 所有新 migration 已在空库 CI 中按时间顺序应用并通过 pgTAP。
- [ ] `supabase migration list --linked` 与预期一致，`db push --dry-run` 只包含本次 migration。
- [ ] 未登录、普通成员、停用成员、管理员和 service role 的权限边界均已复核。
- [ ] 生产 Auth 已启用 Secure password change；普通账号页改密只经过 `change-password`，成功后服务端全局撤销刷新会话、本设备退出，撤销未确认时显示部分成功警告；恢复页仅在 `PASSWORD_RECOVERY` 邮件会话中调用 Auth `updateUser(password)` 并随后全局登出。
- [ ] 公开视图不返回邮箱、QQ、内部错误、审计详情或 Secret。
- [ ] 管理员 RPC 保留鉴权、乐观锁、审计和速率限制；清单与数据库目录中的全部 `admin_*` 函数一致，普通/停用成员无法调用 19 个入口，8 个 `_unlimited` 实现不可由浏览器角色执行。
- [ ] 注销流程的全局租约覆盖“取得租约 → 记录并确认 GitHub 恢复下限 → Auth 删除前续期并确认所有权 → 删除期间每分钟心跳续期 → 释放租约”完整临界区；随后删除业务数据并匿名化审计记录，管理员注销仍要求先交接权限。
- [ ] 管理员提升/降级要求原因、乐观锁、速率限制和二次确认；并发操作也不能移除最后一名启用管理员。
- [ ] 活动同步和当前管理员角色均在数据库最终删除点阻止注销；前管理员降级注销后，公告创建者、审批者及全部审计 JSON 中均无其 UUID。

## 4. Edge Functions 与同步

- [ ] 按“数据库 → Edge Functions → Pages”的顺序部署。
- [ ] `sync-member`、`sync-stats`、`delete-account`、`change-password` 使用仓库 import map 部署成功。
- [ ] 数据库与函数部署后，严格运行 `npm run check:supabase-readiness`，不再允许待部署 migration、缺失函数或 `404` 边界。
- [ ] 发布记录包含当前 Git SHA 与四个 Edge Function 部署后版本号；黑盒就绪检查不作为源码一致性证明。
- [ ] `npm run check:supabase-readiness` 确认四个函数均精确允许正式 Pages Origin、不允许恶意 Origin，且匿名 GET 只返回 `401` 或 `405`。
- [ ] 仅对受控测试成员执行一次单平台同步，快照、运行记录、新鲜度和审计一致。
- [ ] Codeforces、牛客、AtCoder、XCPC ELO、洛谷、QOJ 的固定样本契约测试通过。
- [ ] QOJ 健康检查最多执行一次且不自动重试；临时 Firecrawl 会话最终关闭。
- [ ] 同步失败 Webhook 只发送脱敏任务信息，投递失败不会改变主任务结果。
- [ ] 已确认日更、周更和到期队列 cron 使用 UTC 表达正确的北京时间计划。

## 5. 凭据与外部服务

- [ ] 浏览器构建只含 `VITE_SUPABASE_URL` 和公开 anon key，不含 service role 或第三方凭据。
- [ ] 洛谷 Cookie/CSRF、QOJ 服务账号、Firecrawl key 和告警 Token 均来自可独立轮换的生产 Secret。
- [ ] 注销恢复 Token 只授权目标仓库 Variables write；`DELETION_RECOVERY_REPOSITORY` 指向正式仓库。
- [ ] `ALLOWED_ORIGIN` 只包含实际 Origin，不包含路径或通配敏感域。
- [ ] 生产凭据轮换人、存放位置和回滚方式已记录；未把真实值复制到发布记录。
- [ ] Firecrawl 用量、QOJ 登录、洛谷认证和 Supabase 配额均处于可用状态。
- [ ] 使用与生产 `FIRECRAWL_API_KEY` 相同团队的维护者凭据运行 `firecrawl credit-usage --json --pretty`；剩余比例高于 25%，或已记录扩容/降耗措施。不得把 API Key 或完整凭据配置写入发布记录。

## 6. 前端与可访问性烟测

- [ ] 正式首页、榜单、成员详情、隐私页、注册、登录、账号页和后台可直达并刷新。
- [ ] 访客、普通成员、停用成员和管理员看到的导航与路由符合权限。
- [ ] 部署后的只读生产门禁拒绝演示回退，并用公开视图逐页复算全部成员在总榜与各平台榜的排序、总 Rating、总历史最高 Rating 和总题数。
- [ ] 桌面、390px 移动端和至少一个宽屏视口无页面级横向溢出。
- [ ] 键盘可完成主要导航、筛选、平台标签、分页和高风险确认；焦点可见且顺序合理。
- [ ] 浏览器控制台没有与本次变更相关的 error/warn，分享元数据与方形图标可访问。

## 7. 法务、隐私与发布决定

- [ ] `PRIVACY.md`、站内隐私页、第三方数据来源和实际数据生命周期一致。
- [ ] 已在运维手册核验并填写 Supabase、GitHub Actions 和 Firecrawl 的实际保留窗口、负责人及删除/恢复限制。
- [ ] 受控注销已验证三类结果：租约冲突/删除前续期失败或 GitHub 写入/确认失败返回 `503` 且 Auth 用户未删除；恢复下限确认后 Auth 删除失败返回 `409` 且账号与业务数据仍存在；Auth 删除期间至少跨过两个心跳周期且持续续期，删除完成后的心跳/释放失败不掩盖成功并产生脱敏告警，遗留租约按数据库过期时间自动回收。
- [ ] 受控注销记录“取得租约到 Auth 删除结束”的完整耗时，并确认长尾稳定远低于 5 分钟租约有效期；若无法证明，发布前增加续租或 fencing token，不能仅依赖客户端请求超时。
- [ ] 恢复工具拒绝早于当前注销恢复下限的备份，并拒绝仓库变量回退到备份 metadata 之前。
- [ ] 已按 [数据库备份与恢复方案](./backup-and-recovery.md) 在隔离 Supabase 项目完成解密、校验、恢复、登录和行数核对。
- [ ] 已确认学校、集训队、ICPC 等名称和图形标识的使用授权范围。
- [ ] 已由项目负责人选择并加入 `LICENSE`；在此之前不得把源码描述为开源。
- [ ] 真实队员已小范围核对姓名、专业、年级、平台绑定和统计值。
- [ ] 已观察至少一个完整日更批次；涉及 XCPC ELO/QOJ 时观察到下一个周二批次。
- [ ] 所有阻塞问题已关闭，遗留非阻塞风险有负责人和后续日期。

## 8. 发布与观察

- [ ] 复核人明确给出发布决定后，才创建带注释的 `v1.0.0`（或对应版本）标签。
- [ ] 标签指向已通过全部门禁并实际部署的提交，不在失败构建上移动或复用标签。
- [ ] Pages、认证、后台、同步队列、告警和数据库指标在发布后观察窗口内正常。
- [ ] 若出现故障，已按 [生产运维手册](./operations-runbook.md) 执行 Git revert、函数兼容回滚或数据库前向修复。
- [ ] 发布记录包含验证证据、最终部署 ID、遗留风险和下一位维护者。
