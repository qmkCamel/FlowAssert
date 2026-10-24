# 方案核对与基线验证记录

日期：2026-10-03。分支：`docs/repair-verification-design`；独立 worktree 基于 `origin/dev@REDACTED_REVISION`。

## 本轮交付范围

完成中文 proposal、详细 design、四份增量 spec、实施 tasks 和 Proposed ADR 0016；更新文档索引与产品 TODO。共 24 项需求、48 个规格场景、56 个待实施任务，任务均未勾选。

本轮只做设计。没有实现修复服务、创建源码补丁、操作设备或修改原工作区；没有提交、推送或合并。本轮软件门禁验证的是既有代码基线，不证明拟议修复能力已实现，更不代表真机或独立使用者验收完成。

## 已运行的验证

| 命令／检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 成功；未更改依赖锁文件 |
| `openspec validate add-evidence-guided-repair-loop --strict` | 通过 |
| `openspec validate --all --strict` | 41 项通过 |
| `git diff --check` | 通过 |
| 规划文档本地链接及任务状态核对 | 无失效本地链接，未误标实施完成 |
| `pnpm build` | 通过；在 E2E 前完成 |
| `pnpm pack:check` | 通过 |
| `pnpm check` 与 `pnpm test:e2e` 同时运行的首轮 | 单元测试 806 通过／4 失败；E2E 62 通过／2 失败，详见下节 |
| 随后单独运行 `pnpm check --maxWorkers=2` | 类型、契约检查通过；97 个文件／810 项测试全部通过 |
| 最后单独运行 `pnpm test:e2e --workers=2` | 64 项全部通过 |

OpenSpec 使用已安装的 1.9.0 CLI，Node 使用 24.19.0。E2E 生成的既有跟踪截图只作为本轮基线测试产物，恢复到该 worktree 初始版本，不混入设计改动。

## 首轮失败与结论边界

首轮单元测试失败涉及 comparison 排队取消、orchestration 嵌套取消，以及 workbench 的 Worker 实际退出和已派发控制等待；表现为超时或轮询期限内条件未满足。E2E 失败涉及 Android 快速连接瞬态进度和矩阵失败保留阶段的等待。

降低并发并分别运行后，两套完整测试均通过。该结果提示测试可能对并发负载和时序敏感，但本轮未做根因定位，不能断言问题已修复或将失败简单归因于机器负载。没有修改实现、测试断言、超时或配置来获得通过。

后续实施时应保留这一基线观察；若 CI 或独立运行再次复现，应另行诊断并留存失败证据。不能用本方案的自动修复能力去放宽这些验收条件。

## 后续入口

按 [tasks.md](tasks.md) 从 M1 开始；M2/M3 的离线任务依赖前阶段软件门禁，不依赖把前阶段真实验收虚假勾选。真机、双宿主运行及独立参与者任务分别保留，全部完成前不归档整个变更。
