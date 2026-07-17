# WebChat 当前模型生产验证（2026-07-17）

## 范围

- 生产项目：`qzggoqdmsvktrtnjislw`
- 发布分支：`codex/webchat-ui-shell`
- 发布模式：先关闭态更新，再对显式授权账号受控开启生产模型请求；Pages 入口继续隐藏

本文只记录不含凭据的部署事实，不包含 API Key、JWT、中转站地址、成员身份或聊天正文。

## 实现

- `read_own_webchat_usage()` 只向状态正常且已显式授权的成员或管理员返回当前模型名；未授权、停用或不存在的账号得到 `null`。
- `/assistant` 在本人额度标题中显示后端返回的当前模型。
- WebChat 在每次请求时先解析数据库运行配置，再将同一个模型名写入服务端系统提示词、额度指纹和上游 Responses 请求。
- 模型名只接受 `A-Za-z0-9._:/-` 且最长 128 字符，客户端不能提交或覆盖模型、系统提示词、Base URL 或工具配置。

## 数据库与函数

远程 dry-run 只列出 `202607170010_webchat_model_visibility.sql`。正式 push 成功后，migration list 显示 45 个本地/远端版本全部对齐、0 pending。

`webchat` 使用仓库 import map 和 `--use-api` 部署成功，随后函数列表确认：

- 状态：ACTIVE
- version：5
- JWT 验证：开启
- import map：开启

模型可见性只读验收完成后，根据项目负责人的开放要求将 `CHAT_ENABLED=true` 写入 Supabase Function Secrets；数据库请求开关和测试账号私有授权已经开启，生产 Pages 的 `VITE_WEBCHAT_UI_ENABLED=false` 继续隐藏公共入口。

## 验证

- Vitest：59 个文件、312 项测试全部通过。
- Deno：337 项测试全部通过；entrypoint check 和 101 个文件 lint 通过。
- CI 数据库门禁：PostgreSQL 17 空库实际应用 45 个 migration，并通过 24 个 pgTAP 文件、599 项断言；30 个当前发布 migration 受静态清单保护。
- TypeScript/Vite 生产构建、ESLint、Prettier 和 `git diff --check` 通过。
- 已登录且已授权的 localhost `/assistant` 从生产 RPC 显示 `当前模型 gpt-5.6-sol`，刷新额度后仍一致；页面标题、主内容、额度和对话工作台均正常，无框架错误覆盖层，浏览器 console 无 warning/error。
- 开启服务端熔断后，原先的 `AI 学习助手尚未开放` 不再出现。测试账号完成一条二分答案学习路线的长流式回复，以及“只回答模型标识”的短验证；后者精确返回 `gpt-5.6-sol`，证明模型名已进入真实系统提示词。随后管理员账号在同一 localhost 工作台发送最短验证消息并收到 `OK`，本人额度更新为 4 次请求、6,416 个已结算 Token、0 个预留 Token，页面 console 无 warning/error。
- PR #57 的专用 WebChat Playwright 门禁在 Chromium、Firefox、WebKit、390px 移动端和宽屏环境通过，并在 Chromium 同时驱动 10 个独立页面与 10 路并行 HTTP 流，确认回复不串流且完成后无残留活动连接。

本机 Docker Desktop 未运行，因此无法在本地创建 PostgreSQL 17 空库执行 pgTAP。PR #57 的 Actions run `29593307984` 已补足该证据：`database-security`、`verify` 与独立 `gitleaks` 全部通过，其中新增的 17 项模型可见性断言和其余数据库套件均成功。
