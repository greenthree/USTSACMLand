# 第三方软件、素材与商标说明

根目录 [`LICENSE`](./LICENSE) 授予项目原创源代码，以及未附带其他授权声明的原创文档和配置的 Apache License 2.0 权利。项目使用的第三方软件、字体、品牌标识和视觉素材不因根目录许可证获得额外授权。

## 运行时软件依赖

生产构建根据 Vite 实际纳入 Pages bundle 的模块、`package-lock.json` 和本地安装版本，可复现地生成 `dist/THIRD_PARTY_LICENSES.txt`。该文件逐包记录版本、许可证声明以及 npm 包内随附的 LICENSE、NOTICE、COPYING、COPYRIGHT 或 PATENTS 内容；构建门禁会拒绝缺失包级许可证正文、空白材料、版本不一致或未覆盖关键运行时包的清单。`dist/` 和 `node_modules/` 均为生成物，不提交到仓库。

个别 npm 发布包没有随附包级许可证文件时，只允许使用 `scripts/third-party-license-materials/` 中经过来源核对、固定到精确包版本的材料；不存在对应材料时构建失败，不把 `package.json` 中的许可证声明单独视为可分发正文。若上游只声明 SPDX 许可证而没有提供版权声明，补充材料会明确记录这一缺失并附标准许可条款，不从其他包推断版权归属。

同一构建流程还会把根 `LICENSE` 和本文件逐字复制为 `dist/LICENSE.txt` 与 `dist/THIRD_PARTY_NOTICES.md`，并在 Pages 门禁中复核内容一致。

## Noto Serif SC

`public/fonts/noto-serif-sc/` 中的 Noto Serif SC 字体分片及其 CSS 派生文件依据 SIL Open Font License 1.1 使用。

- 上游项目：[Noto CJK](https://github.com/notofonts/noto-cjk)
- 随字体分发的许可证：[SIL Open Font License 1.1](./public/fonts/noto-serif-sc/OFL.txt)
- 字体名称和保留名称限制以其上游许可证为准。

## 品牌标识与图片

- `public/icpc-foundation.png`、`ICPCLogo-on-dark-smaller.png`：ICPC Foundation 标识。商标、品牌指南和再使用许可由 ICPC Foundation 独立决定。
- `public/ccpc-logo.png`：CCPC 标识。商标、赛事名称和图形使用范围由其权利人独立决定。
- `public/ustsacm.png`：学校 ACM 集训队标识。学校、集训队和校内赛事相关名称与图形授权需由项目负责人另行确认。
- `public/og-image.png`、`public/favicon-192.png`、`public/favicon-512.png`：站点分享图和图标；其中嵌入的品牌标识继续遵循上列独立边界。

除明确写入本文件或文件邻接许可证的内容外，第三方素材的权利人、商标和品牌授权不因项目源代码采用 Apache-2.0 而转移或扩展。分发或改用这些素材前，应保留本说明并核对权利人的当前条款。
