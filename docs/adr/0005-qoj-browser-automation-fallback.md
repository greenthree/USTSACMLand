# ADR 0005：QOJ 临时浏览器自动登录和备用方案

- 状态：已接受
- 日期：2026-07-14

## 背景

QOJ 没有满足当前需求的稳定公开题数 API，用户主页数据需要登录态并可能遇到 Cloudflare。普通 HTTP 抓取无法稳定获得目标成员的去重 Accepted 题数。持续保存个人浏览器会话或在前端登录都会扩大凭据风险。

## 决策

主路径使用 Firecrawl `/interact` 临时浏览器：

1. 每次同步以 `maxAge: 0` 创建新会话，不使用持久 profile。
2. 从 Supabase Function Secrets 读取专用 QOJ 服务账号。
3. 填写登录表单并确认 `Logout` 登录态。
4. 在同一会话打开目标用户主页，读取并去重 Accepted problems。
5. 在 `finally` 中主动结束会话。

QOJ 同步不自动重试。失败保留最后成功题数，并记录 `auth_expired`、`rate_limited`、`schema_changed`、`timeout` 等结构化错误以及脱敏阶段信息。

## 一级备用：管理员手工统计

出现凭据失效、Cloudflare、Firecrawl 限流或结构变化时，管理员可以在成员详情中手工录入 QOJ 题数和审计原因。记录来源为 `admin-manual/v1`，并在下一次成功自动同步后被最新自动值覆盖。

手工录入是临时数据连续性方案，不绕过公开的新鲜度和来源标识，也不能由普通成员执行。

## 二级备用：独立浏览器 Worker

满足以下任一条件时，评估部署独立 Playwright/Chromium Worker：

- 连续计划批次因 Firecrawl 产品限制无法完成。
- Firecrawl 成本或数据保留策略不再符合项目要求。
- QOJ 登录流程需要 Firecrawl `/interact` 无法表达的长期交互。

独立 Worker 必须：

- 继续使用专用服务账号和服务端 Secret。
- 实现与现有 `PlatformAdapter` 相同的成功/失败契约。
- 接受签名或 service-role 保护的任务，不开放公共抓取接口。
- 使用临时上下文并在任务后销毁 Cookie；只有在新增 ADR 和风险评估后才能持久化会话。
- 保留超时、并发限制、审计和“失败不清零”语义。

## 后果

优点：当前无需自建浏览器基础设施；登录和主页查询在一个短生命周期会话内完成；失败有可操作的人工连续性方案。

代价：凭据会作为作业请求发送给 Firecrawl；供应商额度、保留策略和 QOJ 页面变化都会影响同步。

## 未采用方案

- 每次由 Supabase 向 QOJ 直接发送账号密码并解析 HTML：无法稳定通过动态登录和 Cloudflare。
- 持久 Firecrawl profile：会扩大 Cookie 生命周期和跨任务污染风险。
- 在浏览器前端让成员输入公共账号密码：会公开服务凭据。
- 无限或自动重试：会重复消耗会话、加重限流并掩盖凭据错误。
- 使用个人账号：违反凭据隔离原则。

## 运维验证

轮换或修复后运行 `scripts/check-qoj-login.ts`，确认登录态、目标主页结构、去重题数和会话关闭均成功。正式上线还需增加登录失败告警与 Firecrawl 用量监控。
