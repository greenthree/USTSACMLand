# v1.0.0 发布门禁核对 — 2026-07-28

## 已通过

### GitHub 仓库就绪

```powershell
npm run check:repository-readiness -- greenthree/USTSACMLand
```

检查器确认仓库、默认分支和 Pages 配置可读取，观察到 10 个工作流、6 个 Actions Secret 名称、4 个 Actions 变量名称，Actions 默认保留期为 30 天，Pages 正式地址为 `https://ustsacm.fun/`。

### 本地代码与工作流门禁

以下命令全部通过：

```powershell
npm run lint
npm run check:ci-workflow
npm run check:sync-workflow
npm run check:backup-workflow
npm run check:restore-drill-workflow
npm run check:webchat-relay-workflow
npm run check:webchat-cache-probe-workflow
npm test
npm run build
npx --yes deno check --config supabase/functions/deno.json supabase/functions/sync-member/index.ts supabase/functions/sync-stats/index.ts supabase/functions/delete-account/index.ts supabase/functions/change-password/index.ts supabase/functions/firecrawl-config/index.ts supabase/functions/webchat/index.ts supabase/functions/webchat-attachment/index.ts supabase/functions/webchat-image-cleanup/index.ts supabase/functions/webchat-config/index.ts supabase/functions/webchat-cache-probe/index.ts
npx --yes deno lint --config supabase/functions/deno.json supabase/functions
npx --yes deno test --allow-read --allow-env --config supabase/functions/deno.json supabase/functions
git diff --check
```

关键结果：

- CI 数据库路径包含 48 个 pgTAP 文件、1,205 项计划断言和 53 个受保护发布 migration；
- 加密备份工作流包含 7 个逻辑导出、1 个私有 Storage 快照和 14 天保留；
- 隔离恢复演练、WebChat 中转站烟测和缓存探针工作流结构均通过；
- Vitest 共 93 个测试文件、587 项测试全部通过；
- 10 个 Edge Function 入口全部通过 Deno 类型检查，136 个函数文件通过 Deno Lint；
- Edge Function 测试为 462 通过、0 失败、1 项按环境忽略；
- TypeScript、Vite 生产构建、SPA fallback、站点元数据和 bundle 预算均通过。

全仓库 `npm run format:check` 只被用户自有、未跟踪的 `docs/homepage-frontend-audit-2026-07.md` 格式拦截；本轮所有拟提交文件均已单独通过 Prettier。该未跟踪文档未被修改或纳入本轮范围。

## Supabase 注册防护与严格检查

生产现已配置 Cloudflare Turnstile、真实邮箱确认和 Auth 限流。新版 Auth settings 不再公开 `captcha_enabled`，检查器改用“格式无效邮箱 + 无 token”的无副作用注册探针判断服务端 CAPTCHA，不会在 CAPTCHA 关闭时创建用户。

以下两项均通过：

```powershell
npm run check:supabase-preflight
npm run check:supabase-readiness
```

检查确认：

- 项目状态为 `ACTIVE_HEALTHY`；
- 71 个 migration，0 个待部署；
- 10 个 Edge Function；
- 21 个函数 Secret 名称，0 个缺失；
- 0 个 schema lint 发现；
- Auth email readiness、匿名 REST、函数边界和队列调度检查通过。

生产直连烟测确认无 token 与伪造 token 都返回 HTTP 400 / `captcha_failed`，没有创建账号。Pages 已用 Turnstile 变量重新部署，注册页验证前按钮禁用。

同时报告 Supabase 未启用 PITR 且没有供应商物理备份；当前必须继续依赖已完成演练的仓库加密逻辑备份。

## Cloudflare 域名门禁

Cloudflare 控制台已为 `/assets/*` 部署一年期 Edge/Browser TTL 与浏览器可见的 `public, max-age=31536000, immutable` 指令。重新运行 `npm run check:cloudflare-domain` 后，HTML 保持 `max-age=600`，指纹资源为 `max-age=31536000`、包含 `immutable` 且第二次读取为 `CF-Cache-Status: HIT`，门禁通过。完整证据见 [`cloudflare-domain-verification-2026-07-22.md`](./cloudflare-domain-verification-2026-07-22.md)。

## 结论

代码、测试、构建、仓库结构、Cloudflare 长期缓存和注册服务端防护当前健康。仍缺全新真实邮箱的有效 Turnstile 注册、确认前登录拒绝、重复确认幂等和受控 `429` 恢复证据，因此暂不创建 `v1.0.0` 标签，相关 ROADMAP 条目继续保持未完成。
