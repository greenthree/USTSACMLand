# 六平台单次自动重试生产验收

- 验收日期：2026-07-20（Asia/Shanghai）
- 合并提交：`769c3a0c427932328c69decd2f150b85736ca8a3`
- Pull Request：[#96](https://github.com/greenthree/USTSACMLand/pull/96)
- 主分支 CI：[run 29745214706](https://github.com/greenthree/USTSACMLand/actions/runs/29745214706)
- Pages 发布与生产榜单审计：[run 29745843729](https://github.com/greenthree/USTSACMLand/actions/runs/29745843729)

## 部署结果

- 生产数据库已应用 `202607200001_sync_single_retry.sql` 与 `202607200002_clear_public_schema_lint.sql`。
- migration 状态为 58 个本地/远端一致，0 pending。
- `sync-member` 为 v43，`sync-stats` 为 v31；两者均为 `ACTIVE`、启用 JWT 验证并使用仓库 import map。
- 严格就绪检查确认项目 `ACTIVE_HEALTHY`、8 个 Edge Function、0 个必需 Secret 缺失、0 个 `public` Schema lint 问题，Auth、匿名 REST、函数边界和数据库队列调度器均正常。
- PostgreSQL 17 CI 执行 37 个 pgTAP 文件、900 条计划断言，并以 warning 级别 lint `public` Schema。

## 受控生产队列验收

验收使用短生命周期 `sync_jobs` 夹具，只调用数据库原子状态机，不访问 Codeforces、Firecrawl 或其他第三方平台。夹具绑定现有已批准 Profile，但输出、证据和日志不记录成员 ID、姓名、邮箱或平台账号；验收结束后立即删除夹具。

观察结果：

- 第一次结构化 `timeout` 可恢复失败成功转为 `queued`，并产生唯一一次重试时间。
- 第二次 attempt 再次返回可恢复失败后转为 `failed`，`retry_at` 为空。
- 持久状态为 `attempt_count = 2`、`max_attempts = 2`、`status = failed`。
- 对同一第二次 attempt 再次执行 completion 返回 `transitioned = false`，没有第三次状态迁移。
- 受控夹具已清理，未留下活动同步任务，也未产生第三方请求或 Firecrawl 费用。

该生产状态机证据与空库 pgTAP、Edge Function 单元测试和同步工作流门禁共同证明 Codeforces、牛客、AtCoder、XCPC ELO、洛谷与 QOJ 的单平台任务最多执行首次 attempt 加一次持久重试。QOJ 每个真实 attempt 的临时浏览器会话清理仍由适配器测试和后续受控 QOJ 演练持续验证。

## 外部通知决定

产品决定不接入外部告警 Webhook。同步最终失败仍保存在数据库，并通过后台同步中心、数据源健康页和审计记录巡检；该决定不改变自动重试、最终状态、最后成功统计保留或 WebChat 禁止自动重试的边界。
