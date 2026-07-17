# WebChat 当前模型生产验证（2026-07-17）

## 范围

- 生产项目：`qzggoqdmsvktrtnjislw`
- 发布分支：`codex/webchat-ui-shell`
- 发布模式：后端和数据库关闭态更新，不打开生产模型请求

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
- version：4
- JWT 验证：开启
- import map：开启

部署未修改 Supabase Secrets；`CHAT_ENABLED=false` 继续保持，避免本次只读页面验收产生模型请求。

## 验证

- Vitest：59 个文件、312 项测试全部通过。
- Deno：337 项测试全部通过；entrypoint check 和 101 个文件 lint 通过。
- CI 数据库静态门禁：24 个 pgTAP 文件、599 项断言、30 个受保护发布 migration。
- TypeScript/Vite 生产构建、ESLint、Prettier 和 `git diff --check` 通过。
- 已登录且已授权的 localhost `/assistant` 从生产 RPC 显示 `当前模型 gpt-5.6-sol`，刷新额度后仍一致；页面标题、主内容、额度和对话工作台均正常，无框架错误覆盖层，浏览器 console 无 warning/error。

本机 Docker Desktop 未运行，因此本轮无法在本地创建 PostgreSQL 17 空库执行 pgTAP；数据库行为由新增的 17 项测试覆盖，仍须由 PR 的 `database-security` 任务在空库实际执行后作为最终合并门禁。
