# WebChat 关闭态生产部署证据（2026-07-17）

## 范围

- 生产项目：`qzggoqdmsvktrtnjislw`
- 发布分支：`codex/webchat-ui-shell`
- 发布提交：`3025616eed0bc97c04d66a192f4dd540126225de`
- 发布模式：基础设施关闭态部署，不向成员开放模型请求

本文只记录不含凭据的部署事实。没有记录 Supabase Key、Vault 内容、中转站地址、API Key、成员身份或聊天内容。

## 数据库

部署前 `supabase db push --linked --include-all --dry-run` 只列出以下四个 migration：

- `202607170005_webchat_quota_claims.sql`
- `202607170006_webchat_relay_admin_config.sql`
- `202607170007_webchat_budget_monitoring.sql`
- `202607170008_webchat_member_access.sql`

随后使用相同参数执行正式 push，四个 migration 均成功应用。部署后 `supabase migration list --linked` 显示本地与远端均有 43 个 migration，0 pending。

## Edge Functions

生产先写入以下非敏感运行配置：

- `CHAT_ENABLED=false`
- `CHAT_ALLOWED_ORIGINS` 包含正式 Pages Origin 与受控 localhost Origin
- `CHAT_SYSTEM_PROMPT_VERSION=usts-learning-assistant-v1`

首次未显式传入 import map 的部署被 Supabase 打包器拒绝，线上未产生半部署函数。随后使用以下受控命令重新部署：

```bash
npx --yes supabase@2.109.1 functions deploy webchat-config webchat \
  --project-ref qzggoqdmsvktrtnjislw \
  --use-api \
  --import-map supabase/functions/deno.json
```

部署后函数列表显示：

- `webchat-config`：ACTIVE，version 1，JWT 验证开启，import map 开启
- `webchat`：ACTIVE，version 1，JWT 验证开启，import map 开启

部署后记录的六个 ACTIVE Edge Function 版本为：

- `sync-member`：version 36
- `sync-stats`：version 24
- `delete-account`：version 5
- `change-password`：version 6
- `webchat-config`：version 1
- `webchat`：version 1

## 黑盒边界

对 `webchat-config` 从 `http://localhost:5173` 发起预检：

- HTTP 200
- `Access-Control-Allow-Origin: http://localhost:5173`
- 允许 `authorization`、`apikey`、`content-type`、`x-client-info`、`x-request-id`

缺少 Authorization 的 POST 返回 HTTP 401 `UNAUTHORIZED_NO_AUTH_HEADER`，说明请求已进入正常 JWT 网关边界，不再是函数缺失的 404。

生产仍保持三层关闭：Pages 仓库变量未启用，`CHAT_ENABLED=false`，数据库请求开关默认关闭。真实中转站兼容性、管理员写入 Vault 配置和 3–5 名成员试运行不属于本次证据范围。

## 自动化证据与剩余门禁

PR #57 的 `verify`、`database-security`、`gitleaks` 均成功。PostgreSQL 17 空库任务执行 22 个 pgTAP 文件、551 项断言。

部署后严格就绪检查确认项目 `ACTIVE_HEALTHY`、43 个 migration、0 pending、六个函数、0 个 schema lint 问题、Auth/匿名 REST/函数边界/队列调度正常。整体验收仍被三个既有运维 Secret 阻塞：

- `SYNC_ALERT_WEBHOOK_URL`
- `SYNC_ALERT_WEBHOOK_TOKEN`
- `DELETION_RECOVERY_GITHUB_TOKEN`

这些缺口不改变 WebChat 关闭态部署结果，但在正式发布检查单完成前仍必须配置并进行投递或恢复演练。
