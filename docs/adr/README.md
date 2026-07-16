# 架构决策记录

本目录保存 USTSACMLand 已接受的架构决策。ADR 记录“为什么这样做”、安全边界和已知代价；README 负责说明“现在怎么使用”。

## 状态

- `已接受`：当前实现必须遵守；如需改变，应新增一份替代 ADR。
- `提议中`：仍在评估，不能视为实现承诺。
- `已替代`：保留历史原因，并链接到新 ADR。

## 索引

| ADR                                                    | 状态   | 决策                                                    |
| ------------------------------------------------------ | ------ | ------------------------------------------------------- |
| [0001](./0001-static-pages-supabase-backend.md)        | 已接受 | GitHub Pages 静态前端与 Supabase 服务端分离             |
| [0002](./0002-authentication-rls-admin-boundaries.md)  | 已接受 | Supabase Auth、RLS 和受控管理员 RPC 共同构成权限边界    |
| [0003](./0003-synchronization-scheduling-freshness.md) | 已接受 | GitHub Actions 分组调度、同步去重与批次新鲜度           |
| [0004](./0004-secrets-and-credential-management.md)    | 已接受 | Secrets 分层、专用服务账号和凭据轮换                    |
| [0005](./0005-qoj-browser-automation-fallback.md)      | 已接受 | QOJ 临时浏览器自动登录及管理员录入/独立 Worker 备用方案 |
| [0006](./0006-persistent-sync-retry-queue.md)          | 已接受 | 持久重试队列、指数退避、故障恢复和平台并发上限          |
| [0007](./0007-atomic-sync-result-persistence.md)       | 已接受 | 同步结果原子提交、快照幂等与 XCPC ELO 小数精度          |

## 维护规则

1. ADR 一经接受，不通过静默改写隐藏旧决策；重大方向变化新增 ADR 并声明替代关系。
2. 实现状态变化可以补充“验证状态”，但不能把未验证事项写成已完成。
3. ADR 不记录真实项目密钥、账号密码、Cookie、CSRF Token、JWT 或个人信息。
4. 涉及生产权限、第三方数据处理或凭据传输的变更必须同步更新相关 ADR、README 和运维文档。
