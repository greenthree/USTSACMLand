# 训练目标并发上限本地验证（2026-07-31）

## 结论

`202607310001_training_goal_quota_concurrency.sql` 已在全新本地 Supabase 数据库中按时间顺序应用，并通过完整 pgTAP、数据库 lint 和真实双连接竞态验证。整个验证只访问 Docker 中带本项目 Supabase label 的本地数据库，没有向生产或第三方服务发送安全测试请求。

## 验证场景

1. 为本地测试成员准备 19 个进行中的训练目标和一份成功同步快照。
2. 连接 A 创建第 20 个目标，并在提交前保持事务锁。
3. 连接 B 同时创建目标，确认其等待同一成员的事务 advisory lock。
4. 连接 A 提交后，连接 B 重新计数并收到原有 `54000` 额度错误。
5. 最终结果为 `20|1|0`：20 个进行中目标、一个成功并发目标、零个失败方目标；测试成员和关联夹具全部清理。

## 自动化门禁

- `npm run test:db`：48 个 pgTAP 文件、1206 项断言全部通过。
- `npm run check:training-goal-concurrency`：真实双连接检查通过。
- `npm run check:ci-workflow`：确认 CI 必须执行并发检查，且脚本只能指向仓库内验证器。
- `npx --yes supabase@2.109.1 db lint --local --schema public --level warning --fail-on warning`：无 public schema warning。
- `npm run lint`、`npm test`、`npm run build`：全部通过。

生产 migration 尚未部署；本证据只证明仓库补丁与本地数据库行为。
