# 运行时、同步失败与额度通知

四个 Edge Function 支持通过可选 HTTPS Webhook 通知未预期运行时错误；同步服务还会通知终态失败和 Firecrawl 低额度。未配置 Webhook 时业务行为保持不变。

## Supabase Secrets

- `SYNC_ALERT_WEBHOOK_URL`：接收 JSON `POST` 的 HTTPS 地址，不允许在 URL 中嵌入用户名或密码。
- `SYNC_ALERT_WEBHOOK_TOKEN`：代码允许为空，但生产环境要求配置；以 `Authorization: Bearer <token>` 发送。

这两个值只能放在 Supabase Function Secrets，不使用 `VITE_*` 前缀，也不提交真实值。

## 触发规则

- 普通单平台任务会先按照队列策略退避；只有达到最大次数或出现永久错误后通知一次。
- QOJ 不自动重试，因此认证失败、限流、结构变化等终态错误会在本次任务结束时通知。
- 请求校验失败、账号不存在/格式无效和仍在排队的临时失败不通知；认证过期、未配置、限流、结构变化、源不可用、超时及未知内部错误会通知。
- Webhook 超时为 5 秒且不自动重试。投递失败只写入不含 URL、Token 和个人信息的结构化警告，不改变同步任务结果。
- 每周 QOJ 计划批次开始前只读取一次 Firecrawl `/v2/team/credit-usage`。剩余额度不高于 25% 时发送 `warning`，不高于 10% 时发送 `critical`；队列重试和管理员手动同步不重复检查，避免告警风暴。
- Firecrawl 用量检查超时为 5 秒且不自动重试。检查或告警投递失败只记录脱敏事件，不阻断 QOJ 同步。
- `sync-member`、`sync-stats`、`delete-account`、`change-password` 仅在顶层出现非预期 500 错误时发送 `runtime_error`；400/401/403/404/409/429 等已知业务拒绝不发送。
- 运行时告警超时为 1.5 秒，不重试；投递失败不会改变原 HTTP 状态或响应正文。

## Payload

```json
{
  "version": 1,
  "event": "sync_job_failed",
  "jobId": 42,
  "triggerType": "scheduled",
  "attempt": 3,
  "maxAttempts": 3,
  "failedAt": "2026-07-15T00:00:00.000Z",
  "failures": [{ "platform": "codeforces", "code": "timeout" }]
}
```

Payload 不包含成员 ID、姓名、邮箱、QQ、平台账号、Cookie、Token 或第三方错误原文。管理员可使用 `jobId` 在同步中心定位对应运行记录。

Firecrawl 低额度通知使用独立事件：

```json
{
  "version": 1,
  "event": "firecrawl_credit_low",
  "checkedAt": "2026-07-15T16:00:00.000Z",
  "remainingCredits": 90,
  "planCredits": 1000,
  "percentRemaining": 9,
  "billingPeriodEnd": "2026-07-24T12:37:07.733Z",
  "severity": "critical"
}
```

该 Payload 只含团队总额度，不包含 API Key、团队 ID、成员身份或抓取目标。

未预期 Edge Function 错误使用独立事件：

```json
{
  "version": 1,
  "event": "runtime_error",
  "surface": "delete-account",
  "category": "unexpected_error",
  "occurredAt": "2026-07-16T00:00:00.000Z",
  "requestId": "request_123:edge"
}
```

`surface` 只允许四个固定函数名，`category` 只允许固定错误类别；`requestId` 只接受最长 128 字符的网关安全字符。Payload 不发送异常 message、stack、URL、请求体、成员信息或第三方响应。

浏览器端不持有 Webhook Token。React 顶层错误边界会展示可恢复页面，`window.error`、未处理 Promise 和渲染错误只在客户端控制台记录固定事件名、surface 与 category，不记录异常文本；若将来需要集中式前端监控，应单独选择具有限流和数据处理协议的服务，不能把 Supabase Webhook Token 放入 `VITE_*`。

## 生产验收

1. 在受控接收端确认 HTTPS 与可选 Bearer Token 校验正常。
2. 在测试成员的非 QOJ 平台制造可恢复临时失败，确认排队阶段不通知。
3. 让任务达到最大尝试次数，确认只收到一次终态通知。
4. 使用测试 QOJ 凭据演练认证失败，确认首次终态失败通知且不会自动重试。
5. 暂时让接收端返回 `503`，确认同步任务仍按自身结果结束且日志不包含 Webhook URL 或 Token。
6. 使用测试响应把 Firecrawl 剩余额度分别设为 25%、10% 和 25.1%，确认 warning、critical 和不告警边界；生产 smoke test 不通过浪费额度来制造低余额。
7. 在测试函数中制造一个不含成员数据的未预期异常，确认收到一次 `runtime_error`，且 Payload 不含 message、stack、URL 或请求体。
8. 暂时让 Webhook 对运行时告警超时或返回 `503`，确认原函数仍返回自己的 500 响应且没有二次重试。
