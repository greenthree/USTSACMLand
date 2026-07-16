# GitHub 仓库保护设置

本文件记录无法仅靠仓库代码生效的 GitHub 设置。首次正式发布前，由仓库所有者在 GitHub 网页完成，并把验证日期和截图/审计链接保存在私有发布记录中；不要把 Secret 值放入截图。

## `main` 分支规则

在 **Settings → Rules → Rulesets** 为默认分支 `main` 建立启用状态的规则集：

- 要求通过 Pull Request 合并，禁止直接推送到 `main`。
- 要求分支在合并前与目标分支保持最新。
- 要求所有 review conversation 已解决。
- 要求以下状态检查成功：
  - `CI / verify`
  - `CI / database-security`
  - `Secret scan / gitleaks`
- 禁止 force push 和删除默认分支。
- 不允许管理员默认绕过；紧急绕过只在故障处理中临时启用并记录原因。

个人仓库只有一名维护者时可以暂不要求他人批准，但仍应通过 PR 和全部状态检查。增加第二名维护者后，至少要求 1 个非作者批准；涉及 migration、RLS、认证、凭据或删除流程的变更建议要求代码所有者复核。

`Deploy GitHub Pages / build` 只在 `main` 的 `CI` workflow 全部成功后由 `workflow_run` 触发，并检出通过 CI 的精确提交；不能作为 PR 合并前检查。CI 失败或 Pages 部署失败时保留上一可用版本，并按运维手册修复或 revert。

## Actions 与依赖

- **Settings → Actions → General**：工作流默认 `GITHUB_TOKEN` 使用只读权限，仅在单个 workflow 中显式增加所需权限。
- 只允许已审查的 GitHub Actions；仓库 workflow 使用完整提交 SHA 固定第三方 Action，并由 Dependabot 提议更新。
- Dependabot security updates 保持启用；每周依赖 PR 必须经过现有测试，不自动合并大版本更新。
- Actions 日志和 artifact 不得包含 Supabase service role、洛谷 Cookie/CSRF、QOJ 密码、Firecrawl key 或成员私有数据。
- 仓库默认 Actions 日志/Artifact 保留建议设为 30 天以内；数据库备份 workflow 继续用 `retention-days: 14` 单独收紧。2026-07-15 GitHub API 核验的仓库默认值仍为 90 天，因此正式发布前需调整或在风险记录中明确接受。

### 备份与注销恢复下限

- 在 Actions Secrets 配置 `SUPABASE_DB_URL` 和独立的 `BACKUP_ENCRYPTION_PASSPHRASE`；后者至少 32 个随机字符并由密码管理器保管。
- 仓库变量 `BACKUP_RECOVERY_NOT_BEFORE` 初始可不存在，备份工作流会按 `1970-01-01T00:00:00.000Z` 处理；首次受控注销前必须确认 `delete-account` 能创建并回读该变量。
- 为 `delete-account` 创建 fine-grained PAT，只选择本仓库并只授予 **Variables: Read and write**。Token 存入 Supabase Function Secret `DELETION_RECOVERY_GITHUB_TOKEN`，仓库名存入 `DELETION_RECOVERY_REPOSITORY`；不得授予 Contents 或 Administration。
- `Encrypted database backup` Artifact 必须只包含 `.enc` 和 `.enc.sha256`。SQL、解密归档和密码不得出现在 Artifact 或日志。
- 删除 GitHub 变量或撤销 Token 会让成员注销安全失败，这是预期的失败关闭；修复配置前不得绕过服务端注销入口直接删除 Auth 用户。

## 安全报告与环境

- 在 **Settings → Security → Private vulnerability reporting** 启用私密漏洞报告。
- GitHub Pages 使用 `github-pages` environment；生产 Secret 只授予必要 workflow，定期清理不再使用的 Secret。
- 启用仓库可用的 Secret scanning / push protection；Gitleaks workflow 是补充门禁，不替代 GitHub 原生保护。
- 若仓库转移到 Organization，先为 Gitleaks Action 配置其要求的组织许可证，或改用不需要外部许可证的固定版本 CLI 扫描方案。

## 验证

先运行只读检查器；它只读取工作流、运行结论、Secret/变量名称和仓库安全设置，不读取或输出任何 Secret 值：

```powershell
npm run check:repository-readiness -- greenthree/USTSACMLand
```

退出码为 `1` 表示仍有发布阻塞项。检查器会逐文件比较本地与默认分支的 workflow 内容；CI、Pages 和 Secret scan 的最近成功运行必须覆盖默认分支最新提交，5 分钟同步队列必须在 45 分钟内成功，数据库备份必须在 30 小时内成功。因此新增或修改工作流推送后仍需手动或按计划运行一次。

设置后创建一个不改业务逻辑的测试 PR，确认：

1. 三个 required checks 未完成时无法合并。
2. Secret scan 能读取完整历史且不上传报告 artifact。
3. 直接 push、force push 和删除 `main` 被拒绝。
4. Dependabot 能创建 npm 与 GitHub Actions 更新 PR。
5. 合并后 Pages workflow 正常部署，失败构建不覆盖上一可用站点。
