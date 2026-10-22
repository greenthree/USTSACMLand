# Node.js 2026-10-21 安全补丁升级

日期：2026-10-22（Asia/Shanghai）。状态：PR #172 已经负责人批准合并，main CI、Pages 与发布后验证全部完成，生产项目脚本使用 Node.js 22.23.4。最终运行与线上结果见 [生产记录](./nodejs-security-production-2026-10-22.md)；以下保留升级准备阶段的证据。

## 原因与范围

[官方安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)列出 10 项漏洞，最高严重程度为 high。22.x 位于其中 7 项的受影响版本范围，包含 DNS、TLS 和 Brotli 解码问题；[Node.js 22.23.4](https://nodejs.org/en/blog/release/v22.23.4/) 是本次 22.x 修复版本。版本受影响不等于已证明项目内存在可利用路径；没有发送漏洞探测或利用请求。

升级前 `.nvmrc` 为 `22`、根包与锁文件的 Node 约束为 `>=22`。最近一次 main CI [39268662818](https://github.com/greenthree/USTSACMLand/actions/runs/39268662818) 的两个任务实际命中缓存 Node.js `22.23.3`，因此不能把浮动主版本当作已取得补丁。本地默认终端为 Node.js `24.15.0`。

本次修改 `.nvmrc` 为 `22.23.4`，根包与锁文件约束为 `>=22.23.4 <23`，同步 README、ROADMAP 与发布检查单，保留旧检查单的历史验证事实。所有显式调用 `actions/setup-node` 的工作流均已使用 `node-version-file: .nvmrc`，无需复制版本号或更改工作流。此设置只控制项目脚本使用的 Node，不控制 GitHub JavaScript Action 自带的执行运行时；后者由 Action 及 GitHub Runner 提供。

本地项目运行时从 Node.js 官方发布目录安装到被忽略的 `.cli-home/node-v22.23.4-win-x64/`，以官方 `SHASUMS256.txt` 校验下载包。仅在项目验证进程中将它放在 PATH 首位；不替换 Windows 系统 Node 或 Codex 自带运行时。

在此工作区的新 PowerShell 终端继续开发时，可使用已校验的本地运行时：

```powershell
$nodeProjectRuntime = (Resolve-Path .cli-home/node-v22.23.4-win-x64).Path
$env:PATH = "$nodeProjectRuntime;$env:PATH"
node --version
npm.cmd run dev
```

其他工作区应通过自己的 Node 版本管理器安装并选择 `.nvmrc` 指定版本；上述忽略目录不随 Git 分发。

应用依赖版本、源码、Deno Edge Functions、数据库、Secret、调度与生产数据均不在本次修改范围。现有用户修改原样保留。线上静态网站不运行 Node；本次无需部署 Supabase 函数。

## 验证

- 官方下载包 SHA-256：`cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20`，与同版本官方 `SHASUMS256.txt` 一致。
- 安装后的 `node.exe` SHA-256：`dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f`，与官方二进制清单一致。实际执行为 Node.js `v22.23.4`、随包 npm `10.9.9`。
- `npm ci --no-fund` 成功：安装 443 个锁定包，审计 444 个包。没有执行 `npm audit fix`，锁文件除根包的 `engines.node` 外无依赖变更。
- 用现有 semver 库核对运行时、`.nvmrc`、根包与锁文件一致，并确认 `22.23.3`、`24.15.0` 等版本不再符合本项目声明范围。
- `npm test -- --exclude '.codex-tmp/**' --exclude '.cli-home/**'`：**107 个文件、670 项测试通过**。首次无额外排除参数的运行发现旧发布归档中的重复测试，已停止；本次只在命令行排除本地生成物，不修改测试配置或排除任何当前项目测试。
- `npm run test:e2e:chromium -- --reporter=line`：**68 项通过**，覆盖本地页面、交互、布局与 axe 可访问性；没有连接生产业务数据或执行真实同步。
- `npm run lint`、`npm run format:check`、`npm run build` 通过。构建包含 TypeScript、第三方许可证、SPA fallback、站点元数据与入口资源预算检查；原有已归档 Assistant 分块大于 500 kB 的提示仍存在，入口预算通过。
- CI、同步、备份、恢复演练、遗留中转和遗留缓存探针的 6 项 workflow 静态检查通过；仅核对工作流定义，没有执行真实备份、恢复、探针或生产请求。
- 本次不修改 Deno 或数据库，不重复执行 Edge/pgTAP 或生产就绪安全探测；GitHub 完整发布门禁仍待获准后执行。
- 全部日志和下载包仅在忽略目录 `.codex-tmp/node-security-20261022/`，运行时仅在忽略目录 `.cli-home/`，不进入 Git。

## 独立的开发依赖告警

2026-10-22 的 `npm audit --json` 报告 **7 个包告警：2 critical、4 high、1 moderate**。逐一对照锁文件，所有命中节点均为 `dev: true`；`npm audit --omit=dev --json` 为 **0 告警**。这不代表开发环境风险可以忽略，也不代表 Node 补丁会修复这些 npm 包。

| 包                | 锁定版本          | 审计最高级别           |
| ----------------- | ----------------- | ---------------------- |
| `@vitest/mocker`  | `3.2.7`           | moderate               |
| `brace-expansion` | `5.0.9`、`1.1.18` | high                   |
| `js-yaml`         | `4.3.1`           | high                   |
| `source-map-js`   | `1.2.1`           | high                   |
| `tinypool`        | `1.1.1`           | critical               |
| `vite`            | `7.3.6`           | high                   |
| `vitest`          | `3.2.7`           | critical（含传递影响） |

例如 Tinypool 公告为 [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)，Vite 告警包括 [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv)。这些是包级审计结论，不是项目漏洞利用验证。npm 对 Vitest/Tinypool 推荐的自动修复包含 Vitest 主版本迁移，不能混入此次仅升级 Node 的改动；已在 ROADMAP 单独登记兼容性评估与修复待办。

## 发布与回滚

当前 main 仍是 `cfe9abb31a5e040b9e0590bdd24db2235cac1e1e`，最近 Pages [39271148651](https://github.com/greenthree/USTSACMLand/actions/runs/39271148651) 成功。负责人在本地升级完成后要求开始下一步，本阶段提交、推送并创建 PR，跟进完整 CI 到终态；合并和部署按根操作契约另行确认，不触发生产同步、备份或恢复。

为隔离上一轮尚未合入 main 的洛谷发布后文档，发布分支 `codex/nodejs-security-release` 从上述 main 创建，只带入本次 7 个配置和文档文件。主工作区的 Node 升级草稿和用户已有改动均保留；此前本地验证的应用源码、测试、依赖锁定图和工作流与该 main 一致，独立 CI 将再次验证发布分支。

后续按根操作契约获准提交与发布后，等待 CI、Secret Scan、Pages 和 production-ranking-audit 到终态，确认 CI 日志确实使用 `v22.23.4`；再在下一次获准或自然运行的备份任务中核对相同版本。不能以本地通过宣称远端已升级。

若应用回归，优先撤销造成回归的应用改动，保留安全补丁运行时；本次未改应用逻辑，也不需要数据或函数回滚。不得为了绿色 CI 重新允许已知未修复版本。

## 交接

```text
任务：升级项目 Node.js 至 2026-10-21 安全修复版本。
当前发布分支 / 基线：codex/nodejs-security-release / cfe9abb31a5e040b9e0590bdd24db2235cac1e1e；原本地验证分支为 codex/nodejs-october-security。
已完成：安全补丁运行时已安装并校验，配置和文档已更新；独立开发依赖告警已登记。
验证：670 项单元测试、68 项 Chromium E2E、lint、格式、构建、6 项工作流检查通过；生产依赖审计 0，全部依赖审计 7。
生产状态：PR #172 已合并，main 7491a9b 已通过 Pages 发布；完整结果见生产记录。
未提交或用户已有改动：原主工作区的 Node 草稿、域名、洛谷交接、readiness 修改保留；隔离工作区只包含本次候选。
遗留风险：系统默认 Node.js 24.15.0 尚未更新；项目专用运行时已修复。7 个开发依赖包告警仍待独立修复；下次自然备份版本待核对。
下一步：单独处理开发依赖告警；自然备份发生后核对实际 Node 版本。
需要项目负责人输入或批准：无，本次合并和 Pages 发布已批准并完成。
```
