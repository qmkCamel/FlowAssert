## 1. 公开策略与安全基线

- [x] 1.1 记录 `REDACTED_REVISION` legacy-history boundary、当前分支/远端、现有 release-only 分发契约和两张关键截图的 SHA256，确认本 change 保持 `private: true` 且不触发 npm publish。
- [x] 1.2 扩展 `.gitignore`，精确排除真实 `.env`、FlowAssert 本机 JSON、DSH patch、host report、capabilities、设备与签名/provisioning 文件，同时保留安全的 `.example` 文件。
- [x] 1.3 新增 `docs/open-source-readiness.md`，分别列出可自动验证证据和必须在 GitHub 完成的 visibility、历史邮箱、Actions 日志、安全设置、分支保护与 Release 人工检查。

## 2. 公共仓库治理

- [x] 2.1 新增 `CONTRIBUTING.md`，说明 Node/pnpm/DSH 固定版本、开发流程、OpenSpec、必跑门禁、Mock 默认路径、真机证据责任和敏感日志/截图规则。
- [x] 2.2 新增 `CODE_OF_CONDUCT.md` 与 `SUPPORT.md`，声明社区行为、Developer Preview/best-effort 支持范围、安全问题分流及不承诺真机兼容的边界。
- [x] 2.3 新增 `.github/SECURITY.md`，定义支持版本、GitHub private vulnerability reporting、响应流程以及禁止公开提交设备标识、capabilities、签名值、host report、原始日志和未脱敏截图。
- [x] 2.4 新增 `CODEOWNERS`、Dependabot、bug/feature/config issue forms、issue-template config 和 PR template，并让模板强制提示复现环境、证据边界、门禁与脱敏。

## 3. README 与开源入口

- [x] 3.1 重构英文 README 首屏，增加 Developer Preview/分发说明、支持矩阵、五分钟 Mock quickstart、四类使用入口、已脱敏 Mock Viewer 截图和已知限制，再衔接现有详细文档。
- [x] 3.2 同步中文 README 的相同信息架构和版本/命令，链接贡献、安全、支持及公开准备文档，确保中英文仓库内 Markdown 链接全部可解析。
- [x] 3.3 明确 GitHub Release 是唯一安装包渠道、源码为 MIT 且 npm 未发布；确保 README 和 release workflow 都不暗示 npm registry 可用。

## 4. 可重复公开准备检查

- [x] 4.1 实现 `scripts/check-public-readiness.mjs`，以有界、`shell=false` 的 Git 子进程扫描当前跟踪文件和全部可达提交中的私钥头、credential-shaped 值、本机绝对路径与禁止配置文件名，失败输出只包含检查/文件/commit 标识。
- [x] 4.2 在 checker 中加入 community-health/README 标记、`private: true`、禁止 npm publish、legacy boundary 和 boundary 之后 GitHub noreply author/committer email 检查，并对测试占位符使用窄范围 allowlist。
- [x] 4.3 增加确定性 contract tests，覆盖真实泄漏拒绝、占位符允许、输出脱敏、历史 boundary、缺失治理文件和 README 双语标记；增加 `pnpm public:check` 并接入 CI。
- [x] 4.4 扩展 package/release contract，证明新增治理与 readiness 文件不会携带真实配置、覆盖 alpha.1 资产或改变 alpha.2 DSH/MCP bins 和禁止 npm publish 的现有契约。

## 5. 完整验收

- [x] 5.1 运行 Markdown link check、`pnpm public:check`、`pnpm audit --prod --audit-level=high` 与治理/发布 contract tests，确认没有高危依赖或公开准备失败项。
- [x] 5.2 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build` 和 `pnpm pack:check`，人工检查保留的 Viewer runtime screenshot，确认文档/治理改动未破坏真实 Mock UI 路径。
- [x] 5.3 运行严格 OpenSpec validate、`git diff --check`、staged diff/tarball 敏感信息扫描，并确认 `mobile-mirror-ios-physical-final.png`（含“微信”返回入口）与基线 SHA256 字节一致。
- [x] 5.4 原始实施分支与最终 `dev` 集成提交均使用 GitHub noreply author；检查仅暂存目标文件，并以普通 merge 保留两条已推送分支历史。
