# 训练目标并发补丁生产部署（2026-07-31）

## 结论

`202607310001_training_goal_quota_concurrency.sql` 已应用到正式 Supabase 项目，生产 migration 历史与仓库完全一致。此次操作只执行标准 migration 发布与版本核对，没有发送安全测试请求，也没有创建或修改成员训练目标数据。

## 发布记录

1. `supabase migration list --linked` 显示所有历史版本一致，只有 `202607310001` 尚未部署。
2. `supabase db push --linked --dry-run` 只列出 `202607310001_training_goal_quota_concurrency.sql`。
3. `supabase db push --linked` 成功应用该 migration。
4. 再次执行 `supabase migration list --linked`，`202607310001` 的本地与远端版本均存在且一致。

## 边界

仓库空库测试和真实双连接竞态证据见 [`training-goal-concurrency-local-2026-07-31.md`](./training-goal-concurrency-local-2026-07-31.md)。普通成员生产创建流程烟测仍保留为独立待办，不以修改生产统计或批量制造目标替代。
