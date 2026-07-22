# 本地发布门禁 — 2026-07-22

## 范围

本轮针对当前未提交工作区执行前端、构建、Supabase 数据库和 Edge Function 全量门禁。该记录证明本地代码和固定样本通过，不替代真实生产账号、第三方平台或生产 migration 烟测。

## 结果

| 门禁                           | 结果                                                      |
| ------------------------------ | --------------------------------------------------------- |
| `npm test`                     | 80 个测试文件、458 项测试通过                             |
| `npm run test:db`              | 41 个 pgTAP 文件、984 项断言通过                          |
| `npm run format:check`         | 通过；本地工具与 CLI 缓存目录已排除                       |
| `npm run lint`                 | 通过，0 warning                                           |
| `npm run build`                | 通过，SPA `404.html`、站点元数据与 bundle 预算检查通过    |
| Edge Function `deno check`     | 8 个生产入口通过                                          |
| `deno lint supabase/functions` | 117 个文件通过                                            |
| `deno test supabase/functions` | 385 项测试通过                                            |
| CI 工作流静态检查              | 41 个 pgTAP 文件、984 项计划断言、43 个 release migration |
| 同步工作流静态检查             | 游标分页、队列重试所有权和脱敏日志通过                    |
| 备份与恢复工作流静态检查       | 7 份逻辑导出、14 天密文保留及隔离恢复通过                 |
| WebChat 工作流静态检查         | 中转站协议、Abort、缓存及 Vault-only 探针通过             |
| GitHub 仓库只读就绪检查        | 9 个工作流、6 个 Secret 名称、2 个变量名及 Pages 状态通过 |
| `git diff --check`             | 通过                                                      |
| Playwright Chromium            | 35/35 通过                                                |
| Playwright Firefox             | 35/35 通过                                                |
| Playwright WebKit              | 35/35 通过（单项目运行）                                  |
| Playwright mobile-chromium     | 35/35 通过                                                |
| Playwright wide-chromium       | 35/35 通过                                                |

本轮还修复了学习页章节导航辅助文字的 WCAG 对比度，并将 WebKit 冷启动较慢的首个稳定元素等待从默认 7.5 秒提高到 20 秒；榜单方向键切换在 WebKit 中复测通过。推荐计划覆盖邀请码生成、注册绑定、十次奖励上限、事务回滚、注销匿名化、个人导出和管理员审计；分享链接预填、390px 移动布局与账号奖励摘要已通过五个浏览器项目。桌面注册页、移动注册页和账号推荐面板截图检查均无横向溢出或控制台错误。

生产构建仍报告 AI 助手懒加载 chunk 超过 Vite 默认 500 kB 提示；主入口 bundle 通过仓库已有预算门禁，该提示不是本轮回归。

## 后续生产执行

- `202607220001_referral_program.sql` 与 `202607220002_referral_program_global_switch.sql` 已部署到生产 Supabase，远端 migration 总数更新为 63，且无 pending migration。
- 已使用两个随机临时生产成员完成真实注册、邀请码绑定、`1,000,000` Token 奖励到账、被邀请人注销后奖励保留、邀请人注销和残留清理烟测；详细证据见 `production-referral-program-smoke-2026-07-22.md`。
- 本轮没有部署 Edge Function；推荐计划前端仍待发布后页面烟测，全局开关数据库发布证据见 `production-referral-global-switch-2026-07-23.md`。
- Firecrawl、QOJ、账号注销剩余失败边界、WebChat 渠道和 Cloudflare 控制台仍按各自证据中的生产待办执行。
