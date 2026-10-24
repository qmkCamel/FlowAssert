## 1. 版本与适配器

- [x] 1.1 精确升级 DSH 0.2.0-rc.2、Cordis/Schemastery 和开发运行时 peers，刷新并验证 frozen lockfile。
- [x] 1.2 更新版本契约和整个 DSH 家族的混装检查，覆盖版本、模型目录与 HMR 漂移。
- [x] 1.3 声明独立 FlowAssert 消息来源并使用公开附件/消息/工具执行类型，保留二十工具和 shared command/core。

## 2. 探针与回归

- [x] 2.1 更新 Native/PTC 模型图片能力与纯文本 omission projection，测试图片来源、失败和取消边界。
- [x] 2.2 默认 live HMR 和明确 startup-only 配置均验证加载、无重复资源、正常关闭与端口释放；live 验证有效/失败配置后的实例行为。
- [x] 2.3 用同一候选 tarball 验证隔离 DSH 二十工具、注册测试、图片证据、triage、acceptance、外部授权/撤销和双 Mock 矩阵。
- [x] 2.4 同一 tarball 完成独立 CLI/Viewer/MCP 冒烟，并验证慢操作期间其他 UI 控件可交互、结果保留与局部反馈。

## 3. 文档与规格

- [x] 3.1 同步当前支持入口和规格，保留历史版本/证据，记录真实模型和真机验收的独立边界。
- [x] 3.2 运行 pnpm check、pnpm test:e2e、pnpm build、pnpm pack:check、diff 和 strict OpenSpec 门禁，并保存验证记录及截图。

## 4. 本机升级与交付

- [x] 4.1 备份并核对个人 DSH 配置，验证后将全局 CLI 从 rc.8 更新到 0.2.0-rc.2，确认版本及配置未被修改。
- [x] 4.2 核对完整清单与最终 diff，保留独立 worktree 和明确验证边界，不自动合并 dev 或发布包。
