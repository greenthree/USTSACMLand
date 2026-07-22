# 推荐计划生产烟测 — 2026-07-22

本文只记录脱敏结果，不记录临时邮箱、密码、JWT、API Key、GitHub Token 或成员私有资料。

## 部署

- 生产 Supabase 项目状态为 `ACTIVE_HEALTHY`。
- `202607220001_referral_program.sql` 已通过 linked migration 部署。
- `supabase migration list --linked` 显示本地与远端均包含 `202607220001`，共 62 个 migration，无 pending migration。
- 部署前已有 7 个成员推荐码、0 个推荐绑定。

## 真实流程

1. 使用生产公开 Auth 端点注册随机临时邀请人，确认初始奖励次数为 0、奖励 Token 为 0、WebChat 累计 Token 上限为 `5,000,000`。
2. 读取邀请人的 16 位推荐码并通过公开校验函数确认可用。
3. 使用该推荐码注册随机临时被邀请人。
4. 邀请人推荐次数变为 1，奖励 Token 为 `1,000,000`，WebChat 累计 Token 上限变为 `6,000,000`；已使用与预留 Token 均为 0。
5. 被邀请人的个人推荐导出确认 `invitedByAnotherMember: true`。
6. 通过生产 `delete-account` 注销被邀请人后，邀请人的推荐次数仍为 1，累计 Token 上限仍为 `6,000,000`。
7. 再通过生产 `delete-account` 注销邀请人，两次注销均返回 HTTP 200 和 `deleted: true`。注销前恢复下限已由维护端单调前推并回读，函数成功读取该下限；本轮未倒退变量来强制测试 Edge 写入分支。

## 清理核验

- 两个临时 Auth 用户均返回 404。
- 两个临时 Profile 均不存在。
- 临时推荐码与推荐绑定均不存在。
- 生产推荐码总数回到 7，推荐绑定总数回到 0。
- `private.account_deletion_recovery_lease` 为 0，没有遗留删除租约。

## 结论与剩余范围

生产数据库已验证真实注册、单次绑定计奖、`1,000,000` Token 到账、被邀请人注销后奖励保留和邀请人注销级联清理。十次邀请上限、并发争抢、重复注册回滚和前端页面仍分别依赖现有 pgTAP/浏览器自动化或后续受控生产验收，不能由本次单次绑定烟测替代。
