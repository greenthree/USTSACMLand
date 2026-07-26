# 数据库备份容量门禁与手动备份证据（2026-07-26）

## 容量依据

- 上一轮成功备份运行 `30167705101` 的加密 Artifact 实际为 `345,402` 字节。
- WebChat 图片第一版限制为每账号最多 `200` 个对象、`64 MiB`；按 50 名成员估算，最坏为 `10,000` 个对象和 `3,355,443,200` 字节图片数据。
- GitHub Actions Variables 已配置为：
  - `MAX_STORAGE_OBJECTS=10000`
  - `MAX_BACKUP_ARTIFACT_BYTES=3500000000`
- 字节上限覆盖 50 名成员的账号级理论上限，并为数据库、清单、校验和与封装保留约 138 MiB 余量，同时低于单个 GitHub Artifact 的 4 GB 上限。变量只负责失败关闭，不会预占 Artifact 容量。

## 手动备份结果

- 工作流：`Encrypted database backup`
- 运行：[`30192826527`](https://github.com/greenthree/USTSACMLand/actions/runs/30192826527)
- 触发方式：`workflow_dispatch`
- 结论：`success`
- 源提交：`b0b91a80d71150e99df8025c8359739437db783e`
- 运行时间：2026-07-26 07:27:10Z 至 07:30:48Z
- Artifact：`ustsacmland-database-backup-30192826527-1`
- GitHub API 报告大小：`348,362` 字节

下载后的 Artifact 文件白名单核对为：

```text
ustsacmland-database-backup.enc         347920 bytes
ustsacmland-database-backup.enc.sha256      98 bytes
```

工作流已在 Runner 内完成 Schema v2 Storage 计划、引用对象下载、清单/哈希、解密抽查、文件白名单和明文清理；任一 Storage 或校验步骤失败都不会进入 Artifact 上传。下载核对没有解密备份，也没有读取或记录备份口令。

## 后续观察

本次工作流成功，但 GitHub Runner 提示 `actions/upload-artifact` 的 Node.js 20 运行时已被强制切换到 Node.js 24。该提示当前不影响备份结论；后续升级固定 action 版本时应消除提示，并继续保留提交 SHA 固定与工作流自检。
