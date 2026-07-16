# 适配器固定样本

本目录保存第三方数据源的最小脱敏样本，用于离线解析和适配器契约测试。

规则：

- 用户名、UID、姓名、比赛名和提交记录均为测试值或已脱敏值。
- 样本不得包含 Cookie、CSRF Token、Authorization header、邮箱、QQ、密码或真实 Firecrawl Job ID。
- 只保留验证统计口径和结构变化检测所需字段，不保存整页个人资料。
- 上游结构发生兼容性变化时，新增或更新样本，并同步修改解析测试；不能只放宽解析器而不留下回归证据。

| 平台       | 固定样本                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Codeforces | `codeforces-user-info.json`、`codeforces-user-status.json`                                      |
| 牛客       | `nowcoder-practice-rated.html`、`nowcoder-rating-history.json`、Firecrawl rated/unrated JSON 等 |
| AtCoder    | `atcoder-history-rated.json`、`atcoder-ac-rank.json`                                            |
| XCPC ELO   | `xcpc-elo-data.txt`（内容保持官网 `data.js` 的 JSON 赋值格式）                                  |
| 洛谷       | `luogu-record-page.json`（与 `ckp.py` 一致，仅使用 Accepted 记录列表）                          |
| QOJ        | `qoj-firecrawl-accepted.json`                                                                   |
