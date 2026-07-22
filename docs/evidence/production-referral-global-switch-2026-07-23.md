# 推荐计划全局开关生产发布 — 2026-07-23

本文只记录脱敏结果，不记录成员身份、JWT、API Key、数据库密码或原始响应正文。

## 发布前门禁

- 本地 Supabase 从空库依次应用 63 个 migration 成功。
- `41_referral_program_global_switch.test.sql` 的 37 项断言通过；完整数据库测试为 41 个文件、984 项断言通过。
- 完整 Vitest 为 80 个测试文件、458 项测试通过；ESLint、Prettier、生产构建与 `git diff --check` 通过。
- 独立代码审查发现并修复纯空白审计原因与邀请码奖励容量预检不一致问题，限定复核未发现遗留问题。

## 数据库部署

- `npm run check:supabase-preflight` 确认项目为 `ACTIVE_HEALTHY`，预期只有 `202607220002` 待应用；21 个 Function Secret 名称齐全，Schema lint 为 0，Auth、匿名 REST、八个 Edge Function 和队列边界均通过。
- `db push --dry-run` 精确只列出 `202607220002_referral_program_global_switch.sql`。
- 已通过 Supabase CLI `2.109.1` 应用该 migration。
- 部署后的 linked migration 列表显示本地与远端均为 63 个 migration、0 pending。
- 严格 `npm run check:supabase-readiness` 再次通过；项目仍未启用 PITR 且没有供应商物理备份，继续依赖已演练的加密逻辑备份。

## 已验证边界

- 私有单例配置、管理员读取/更新 RPC、原因规范化、乐观锁、速率限制、脱敏审计和浏览器角色授权矩阵均由 pgTAP 覆盖。
- 公开邀请码检查、成员摘要、注册触发器和奖励事务读取同一开关，并在下一次奖励会超过 Token 上限时一致返回不可用。
- 关闭期注册降级、重新开启不追补、原邀请码保留、重复响应对账和一致锁序已由数据库与前端自动化覆盖。

## 待完成生产烟测

- 发布包含后台面板、账号页和注册页状态的 GitHub Pages 前端。
- 使用真实管理员完成关闭、关闭期无邀请码注册、关闭期旧邀请链接、重新开启和审计投影烟测。
- 使用两个独立数据库连接验证注册与开关切换的事务围栏，并执行一次前向恢复或等价受控回滚演练。
- 完成桌面、390px 移动端、键盘和无障碍页面验收后，才能勾选 ROADMAP 对应条目。
