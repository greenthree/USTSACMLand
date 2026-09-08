# 线上比赛函数生产部署证据（2026-09-07）

## 范围

- 生产项目：`qzggoqdmsvktrtnjislw`（`USTSACMLand`）
- 执行分支：`codex/fix-xcpc-upstream-schema`
- 执行提交：`ca4bdf8`
- 仅部署：`contest-calendar`
- API 迁移后重新部署：最终 version `6`

本文只记录不含凭据的部署事实，不记录 Supabase Key、Cookie、Token、成员身份或上游响应正文。

## 部署前后检查

- `npm run check:supabase-preflight`：通过。生产项目 `ACTIVE_HEALTHY`，76 个 migration、0 个 pending、0 个 public schema lint findings、25 个 Function Secret 名称且无缺失。
- 首次预检曾提示 `contest-calendar` 尚未部署；生产未启用 PITR/暂无物理备份仍为既有告警，不是本函数部署阻塞。
- 使用仓库 import map 通过 Supabase API 部署 `contest-calendar`，未执行 `db push`。
- 部署后函数状态：`contest-calendar` 为 `ACTIVE`，version `6`，JWT 校验关闭（公开匿名 GET 设计），import map 已启用。
- 其他函数未部署，数据库、Secret/Vault、Pages 和生产开关未修改。

## 部署后验证

- `npm run check:supabase-readiness`：通过。13 个 Edge Functions、0 个 pending migration、0 个 schema lint findings，Auth、匿名 REST、Edge Function boundary 与 queue scheduler 均为 ready。
- 使用合法的 2026-09-05 至 2026-09-21 UTC 窗口执行公开 GET：最终 HTTP `200`，返回 JSON 且 `events` 为数组（本次返回 28 条）。
- 函数现调用 clist.by 官方 `/api/v4/contest/` API，使用 `host`/`resource` 平台字段和官方 `href` 映射；本次验证未输出上游正文或 Secret，也未绕过第三方反自动化挑战。

## 遗留风险

若 clist.by API 上游不可用或返回认证/结构错误，线上比赛页会按失败关闭契约显示暂时不可用状态。API Key 轮换后只需更新对应 Function Secret 并重新部署该函数。
