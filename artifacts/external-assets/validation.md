# 第五项工程验证（2026-10-01）

分支：`feat/change-acceptance-roadmap`；前置 `REDACTED_REVISION`，方案 `REDACTED_REVISION`。本目录样本和截图来自人工合成数据与 Mock，不是 Maestro/Appium 真机兼容证明。

| 验证 | 结果 |
| --- | --- |
| `pnpm check` | 81 文件 / 709 测试通过；含类型、契约、worker、CLI/API、授权、引用及 3 个真实 SIGKILL 发布切点 |
| `pnpm build` | 通过；包含 external-parser / external-files 和 worker |
| `pnpm test:e2e` | 59/59 通过；随后局部取消按钮边界微调后外部报告专项 1/1 再次通过 |
| `pnpm pack:check` | 通过 |
| `pnpm test:application:probe` | 通过，共享组装与关闭链 |
| 同包 release-candidate-probe | 通过，仓库外安装；CLI 真字节导入/查询、MCP 授权/撤销、19 工具、Viewer、原生 YAML |
| 同包 dsh-clean-profile-probe | DSH 0.1.5-rc.2 Native/PTC 通过，包含默认拒绝→授权摘要→撤销拒绝、19 工具与受控关闭 |
| OpenSpec strict | 通过，真实验收任务保留未勾选 |

同一 tarball：`mobile-mirror.tgz`，SHA-256 `e8066f5f9b5b64fc5f52cbf1c284bc69a1b4d6a7e1f388de0649285197e85ac9`。安装探针使用该包，没有另建 Maestro/Appium 执行器。包版本仍为 0.1.0-alpha.2，不代表新正式发布。

## 故障和重试记录

- 初期类型检查修正可选参数的 undefined 赋值及测试辅助函数过窄推断。
- 测试中不能直接 spy ESM 原生模块命名空间，改为 Vitest 的显式模块 mock；再验证路径身份变化拒绝。
- 浏览器取消发现新上传误用上一已完成任务 ID，改为每次操作身份；测试覆盖迟到响应和旧结果保留。
- 完整 E2E 重生成既有 streaming.png，使随后 public:check 和一次完整 check 的公开截图 hash 检查失败（其余 708 测试通过）。保留生成图到本机临时验收目录，核对原工作区图片与 public-readiness.config.json 的登记 hash 一致后，在隔离工作树复制回基准；没有修改原工作区或放宽校验。失败输出保留在 check-after-e2e-mismatch.log。
- 构建、E2E 和打包串行执行；外部导入运行中原生历史/语言仍可交互。desktop.png、narrow.png 已人工查看：无页面溢出，报告中的 script 字样仅为文本，取消保留已导入结果。

## 未完成的真实验收

没有真实 Maestro JUnit 和 Appium 客户端 runner JUnit 的版本/生成命令/许可冻结记录，没有既有资产持有方独立迁移验收。因此 OpenSpec 5.1、5.2、5.6 不勾选，不归档，不声称所有外部框架已经兼容。后续第六项独立工程可继续。
