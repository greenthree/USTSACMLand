# ADR 0004：Secrets 分层、专用服务账号和凭据轮换

- 状态：已接受
- 日期：2026-07-14

## 背景

项目需要 Supabase service role、Firecrawl API key、QOJ 服务账号和洛谷 Cookie/CSRF Token。部分配置会由 Vite 注入浏览器，部分由 GitHub Actions 或 Edge Functions 使用。错误分层会导致凭据进入静态包、日志或 Git 历史。

## 决策

按运行位置分为三类：

| 存储位置                  | 内容                                                                                                   | 是否进入浏览器         |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| Vite `VITE_*`             | Supabase URL、anon key                                                                                 | 是，必须按公开信息处理 |
| GitHub Actions Secrets    | 项目 ref、service role key、前端生产配置、数据库备份 URI 与独立加密口令                                | 否                     |
| Supabase Function Secrets | Firecrawl key、QOJ 服务账号、洛谷 Cookie/CSRF、告警 Webhook、注销恢复下限 GitHub Token、CORS allowlist | 否                     |

本地开发使用被 `.gitignore` 排除的 `.env.development.local`。仓库只提交变量名和非敏感说明，不提交真实值。

QOJ 和洛谷必须使用与个人账号、邮箱和其他系统完全隔离的专用服务账号。任何在聊天、截图、日志、终端历史或公开仓库中暴露过的凭据视为已泄漏并立即轮换。

## 使用规则

- `service_role` 和第三方凭据禁止使用 `VITE_*` 前缀。
- 错误日志只记录结构化错误码、阶段、HTTP 状态和脱敏 Job ID，不记录密码、Cookie、Authorization header 或完整响应正文。
- 洛谷 Cookie 与 CSRF Token 成对轮换，并在轮换后运行受控同步烟测。
- QOJ 密码轮换后更新 Supabase Secret，并运行登录健康检查。
- Firecrawl 接收 QOJ 登录字段属于第三方数据处理；当前未启用 Zero Data Retention，必须使用可独立废弃的服务账号。
- GitHub Actions 输出不得打印 secret；curl 只把响应写入临时工作区。
- 数据库备份口令不得与数据库、GitHub、邮箱或第三方平台密码复用；工作流只上传加密文件和密文校验值，SQL 明文必须在上传前删除。
- 注销恢复下限 Token 使用 GitHub fine-grained PAT，只授权单个目标仓库的 Variables write；不得授予 Contents、Administration 或其他仓库权限。
- 告警 Webhook 只接受不含 URL 用户名/密码的 HTTPS 地址；可选 Bearer Token 只从 Function Secret 读取，投递日志不得包含 URL 或 Token。

## 轮换触发条件

以下任一情况立即轮换：

- 凭据出现在聊天记录、截图、日志或 Git 历史。
- 返回 `auth_expired`、明确的登录拒绝或服务账号被停用。
- 管理员/维护人员交接或权限范围变化。
- 第三方平台发生安全事件或账号异常登录。

轮换步骤为：创建/更新专用凭据，更新对应 Secret，运行最小烟测，确认成功后撤销旧凭据，并在审计记录中只写原因和时间。

## 后果

优点：静态站点泄漏不会直接暴露抓取账号；凭据可以按服务单独撤销。

代价：凭据分布在 GitHub 与 Supabase 两处，需要维护清单、轮换步骤和权限交接。

## 未采用方案

- 将凭据写入源码或 `.env.example`：会进入 Git 历史。
- 复用个人账号或常用密码：一次供应商泄漏会扩大到其他系统。
- 在数据库普通业务表保存密码：会增加查询与备份暴露面。
- 依赖聊天上下文“记住密码”：聊天不是秘密管理器，无法提供可靠轮换和访问审计。
