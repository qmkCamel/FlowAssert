## Why

FlowAssert 已具备安装、Mock、MCP、DSH rc.8 和真机操作文档，但公共仓库入口、贡献治理与公开前隐私检查仍不完整。需要在仓库切换为 Public 之前建立可复核的开源入口和安全门禁，避免新用户只能沿开发者内部路径安装，也避免个人配置、提交邮箱或运行证据被无意公开。

## What Changes

- 明确首阶段分发策略为“GitHub 公共源码 + GitHub Release 安装包”，继续保留 `private: true`，不发布公共 npm 包。
- 重构中英文 README 首屏，增加五分钟 Mock 快速开始、“只体验 / DSH / MCP / 真机”四条入口、固定版本支持矩阵、Developer Preview 状态、非目标范围和已知限制，并展示一张已经脱敏的 Viewer 截图。
- 新增 `CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`.github/SECURITY.md`、`SUPPORT.md`、Issue forms、PR template、`CODEOWNERS` 和 Dependabot 配置，说明贡献门禁、支持边界、私密漏洞报告与日志脱敏要求。
- 增加可重复的公开准备检查，覆盖当前可达 Git 历史和工作树的敏感模式、个人作者邮箱报告、本机绝对路径、私钥/令牌、配置文件与发布包内容；检查只报告风险，不自动重写已推送历史。
- 扩充 `.gitignore` 与安全示例，默认排除真实 `.env`、DSH patch、本机 FlowAssert JSON、host report、capabilities 和设备/签名配置，同时保留可审阅的 `.example` 文件。
- 增加公开前人工检查清单，要求确认历史作者邮箱是否可公开、审阅 GitHub Actions 历史日志、核对 Release/截图和启用 GitHub 安全设置后再切换可见性。
- 明确保留现有带“微信”返回入口的 iOS 截图，不裁剪、不重录、不删除；其他文档与门禁不得把这张截图误判为待修复项。

## Capabilities

### New Capabilities

无。本 change 只调整仓库文档、治理、检查和发布准备，不改变 FlowAssert 的运行时产品行为。

### Modified Capabilities

无。现有 DSH、MCP、Viewer、Appium、Android 与 iOS 契约保持不变；本 change 已在 `.openspec.yaml` 中声明 `skip_specs: true`。

## Impact

- 影响中英文 README、公共仓库治理文件、`.gitignore`、公开准备检查脚本、package scripts/contract tests 和 OpenSpec 记录。
- 不修改 agent loop、Cordis 注册、MirrorService、provider、Viewer 交互、真机截图内容或现有 GitHub Release 资产。
- 不执行仓库可见性切换、不发布 npm 包、不删除 GitHub Actions 日志，也不重写或强制推送既有 Git 历史；这些外部或破坏性动作必须在人工检查清单通过后单独授权。
