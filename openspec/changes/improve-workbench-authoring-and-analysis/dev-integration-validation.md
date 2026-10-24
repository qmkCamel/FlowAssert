# `dev` 集成验证记录

日期：2026-10-04。将功能提交 `REDACTED_REVISION` 合入 `origin/dev@REDACTED_REVISION`，在隔离工作树构建与验证。本记录是合并提交前的验证；最终提交和远端 SHA 以 Git 为准。

## 冲突处置与契约

- 保留 `dev` 原有项目模板/导出 API 与测试，分别迁至 `workbench-acceptance-project.ts` 和同名测试；新 durable Viewer acceptance 仍由 `workbench-acceptance.ts` 实现。调用方改用新文件路径，不以覆盖同名模块消除功能。
- 应用组合同时保留 `dev` 的外部结果、OCR、矩阵、变更验收和新用例库/受理；只创建一个 investigation 实例并随应用关闭排空。旧工作台的这些面板仍可通过 `#/legacy` 进入。
- `dev` 在功能基线之后追加 `mobile_acceptance_get`、`mobile_external_result_get`、`mobile_matrix_status` 三个只读宿主工具。契约测试仍冻结原 17 项顺序，并在单独的 dev 集成基线中精确记录 3 项后缀及 8 个上游修改文件的 hash；本功能自身不扩张宿主工具面。

## 软件与候选包验证

| 检查 | 合并后结果 |
| --- | --- |
| `pnpm check` | 通过：103 个文件、846 项单测，含类型与 bundle contract |
| `pnpm test:e2e --workers=1` | 通过：73/73，含新用例/分析、旧工作台、外部资产、OCR、矩阵和变更验收 |
| `pnpm build` / `pnpm pack:check` | 均通过 |
| `pnpm public:check` | 通过；公开 Mock 截图与清单 SHA 一致，保留的真机图未替换 |
| OpenSpec | change strict 通过；主规范 30/30 通过 |
| 实际解包候选 Viewer/application | Mock 保存→校验→执行→分析→归档、重开修订/原 verdict，以及应用引用/关闭探针通过 |
| 实际解包候选 MCP/CLI | stdio 20 工具、catalog/flow/suite/cancel/evidence/triage、双 Mock 矩阵、证据 hash、本地化与信号清理通过 |

候选 `flowassert-0.1.0-alpha.2.tgz`，SHA256 `d067c4653f51db29485ffc4a3f2e0d9dbeb505dec99fa827ef010033c8ce7a78`；Node `24.19.0`、pnpm `11.7.0`。解包探针使用本次 frozen lockfile 安装的依赖软链接，并非任意干净环境安装验证。

新 Viewer 的本轮运行截图已目视检查：`journey-authoring-desktop.png`、`journey-analysis-desktop.png`、`journey-analysis-narrow.png`。其余 E2E 自动生成的旧截图没有作为此次合并的产品变更纳入提交。

## 宿主与验收边界

合入前功能基线曾用固定依赖的 DSH `0.1.5-rc.2` clean profile 跑通 Native/PTC；本次合并候选的独立 DSH 探针**未通过，不能写成集成宿主已验收**。本机全局 `dsh` 是 `0.1.0-rc.8`，与探针模式不兼容；另在隔离目录尝试安装 `0.1.5-rc.2`，npm 的 prerelease 依赖解析带入混合版本及缺失的 peer 包，启动失败。没有改动 DSH agent loop，也没有把安装问题归咎于本插件运行逻辑；发布前应以完整固定的 DSH rc.2 依赖树重跑同一候选 clean-profile 探针。

本轮仅证明软件/Mock 路径；Android/iPhone 真实 App、外部试点和用户成效研究仍待独立验收。原本地 `dev` 工作树的未提交截图与其他草稿未触碰。
