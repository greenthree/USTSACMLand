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

## Supabase 发布前检查

```powershell
npm run check:supabase-preflight
```

只读检查确认：

- 项目状态为 `ACTIVE_HEALTHY`；
- 71 个 migration，0 个待部署；
- 10 个 Edge Function；
- 21 个函数 Secret 名称，0 个缺失；
- 0 个 schema lint 发现；
- 匿名 REST、函数边界和队列调度检查通过。

检查器按设计返回失败并报告两个发布阻塞项：

1. 生产 Auth 仍自动确认邮箱，无法证明注册者控制邮箱；
2. 生产 Auth 未启用服务端 CAPTCHA，匿名请求可绕过网页直接调用注册接口。

同时报告 Supabase 未启用 PITR 且没有供应商物理备份；当前必须继续依赖已完成演练的仓库加密逻辑备份。

## Cloudflare 域名门禁

Cloudflare 控制台已为 `/assets/*` 部署一年期 Edge/Browser TTL 与浏览器可见的 `public, max-age=31536000, immutable` 指令。重新运行 `npm run check:cloudflare-domain` 后，HTML 保持 `max-age=600`，指纹资源为 `max-age=31536000`、包含 `immutable` 且第二次读取为 `CF-Cache-Status: HIT`，门禁通过。完整证据见 [`cloudflare-domain-verification-2026-07-22.md`](./cloudflare-domain-verification-2026-07-22.md)。

## 结论

代码、测试、构建、仓库结构和 Cloudflare 长期缓存门禁当前健康；生产注册滥用防护仍未完成，因此不得创建 `v1.0.0` 标签，`ROADMAP.md` 的最终发布条目继续保持未完成。
