# 方案阶段核对记录

日期：2026-10-07。代码基线：`dev@REDACTED_REVISION`；方案分支：`feat/scoped-environment-preflight`。

## 当前交付边界

- 本轮仅新增中文 proposal、design、三份 delta specs、tasks 和本记录；没有修改运行代码、主规格、用户环境或设备。
- OpenSpec 规划依赖完整，`tasks.md` 共 29 项，全部未勾选。规划 complete 不等于实现 complete。
- 现有截图/报告不属于本方案交付；以下执行结果是当前代码基线检查，不能勾选未来实现任务或替代新增交互/真机验收。
- `openspec-propose` 的规划边界要求交付方案后等待下一轮明确实现请求；本轮未进入 apply。

## 已执行检查

| 命令 | 结果 | 边界 |
| --- | --- | --- |
| `openspec validate add-context-aware-environment-preflight --strict --no-interactive` | 通过 | 仅结构/规格校验 |
| `openspec validate --all --strict --no-interactive` | 51/51 通过 | 不代表各变更实现验收完成 |
| `pnpm check --maxWorkers=2` | 失败：127 个测试文件中 126 通过、1 失败；1118 项测试中 1117 通过、1 失败 | TypeScript 与契约检查通过；失败项见下文 |
| `pnpm test:e2e --workers=1` | 83 通过、1 跳过 | 现有浏览器基线；不是新预检交互证据 |
| `pnpm build` | 通过 | 现有代码构建 |
| `pnpm pack:check` | 通过 | 现有包产物检查；不是四入口新功能探针 |
| `git diff --check` | 通过 | 已跟踪差异空白检查；新方案另经严格规格验证 |

OpenSpec CLI 使用本机已有的 1.9.0 安装，未安装或升级工具。构建输出保留原有依赖 bundling 提示，不将其描述为无警告。

## 基线失败与待验收项

`tests/public-readiness.test.mjs` 的 Git 历史扫描发现提交 `REDACTED_REVISION` 中 `openspec/changes/upgrade-dsh-020-rc2/merge-validation.md` 的 `absolute-home-path`。当前文件已脱敏，但历史仍包含该内容。本变更不重写历史、不放宽扫描；此问题不是新预检实现失败，也不能因此声称仓库全绿。

下一轮需按 [tasks.md](tasks.md) 实现及重跑验证。真实 DSH profile 和 Android/iPhone 只读抽样分别登记；没有进行本轮宿主或设备验收，不能以历史记录、Mock 或本次打包通过替代。
