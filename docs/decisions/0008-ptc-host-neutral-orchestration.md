# ADR 0008：PTC 作为宿主编排入口，测试执行保持宿主无关

- 日期：2026-09-17
- 状态：Accepted；2026-09-18 核心实现及确定性 adapter 验证完成，打包与真机证据继续按 OpenSpec tasks 收尾
- 背景与证据：[PTC 与 Codex 调研](../research/ptc-architecture-and-codex-2026-09-17.md)
- 2026-09-18 实现：[运行级 Agent 契约设计](../../openspec/changes/add-agent-test-run-control/design.md)；五工具、单 runtime 协调器、持久受理、本机设备 claim 与有界证据已落地，使用见[Agent 运行指南](../agent-test-run-control.md)。

## 建议决策

1. DSH 保留 defineTool/registry 薄适配，PTC runtime 由 DSH 装配；Codex 使用现有 stdio MCP。MirrorService 不依赖任何宿主 runtime。
2. 固定测试和业务验证继续由 Workbench、AppClaw 与可信扩展负责。拟新增的运行控制 API 由 DSH/MCP 共用命令契约，返回 runId 与有界证据，不暴露任意代码执行。
3. 同设备只有一个活跃控制 owner。代码复用不等于跨进程共享 session；跨宿主同时接入需先明确 owner 协议，不允许独立启动两个控制会话。
4. PTC 子调用执行成功不自动成为测试通过；run、attempt、UI/business/evidence/cleanup 结果继续由现有测试域裁定。
5. 复用已完成的 rc.2 兼容闭环，调研快照中的 alpha/master 仅做隔离对照。暂不迁移 YAML/扩展到 ctx.ptcRuntime，不引入 Python backend，不自建 MCP eval。

## 后果与放行条件

优点是保持独立 Viewer/CLI 与 Codex 可用，复用已有取证与权限边界；代价是需要本机登记项目、显式证据分享策略和 owner claim 诊断。请求幂等、取消/断连、来源关联与 owner 已进入实现；同 tarball 宿主、双端真机和模型图片消费仍以 change tasks 的实测为准。

版本、sandbox、超时和结果语义以调研文档的固定 SHA 为准。实施时创建独立 OpenSpec change 并更新相关主规格，原 ADR 0001/0002/0006 继续有效。
