# DSH 0.2.0-rc.2 适配验证

日期：2026-10-07。环境：macOS arm64、Node 24.19.0、pnpm 11.7.0。分支 `feat/upgrade-dsh-0.2.0-rc.2`，从 `origin/dev@REDACTED_REVISION` 建立独立 worktree。

本次支持的精确宿主是 **0.2.0-rc.2**。公共 npm registry 尚无 `0.2.0` 正式包；不将此 RC 写成正式版，也不跟随 `0.2.1-alpha.1`。

## 适配内容

后续环境准备入口见 [Doctor v2](environment-preflight.md)：显式指定同一 executable/profile，精确核对 rc.2 及安装依赖元数据；不读取完整配置推断启用。独立验收使用 `scripts/preflight-dsh-probe.mjs <absolute-dsh> <absolute-tarball>`，会在临时 profile 安装并启动真实 Native/PTC 宿主，**不是普通预检的一部分**。本页以下保留原适配验收记录，新增证据见 [按范围预检实施记录](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-context-aware-environment-preflight/implementation.md)。

- DSH peers 与开发运行时家族固定到 0.2.0-rc.2；Cordis 4.0.4、Schemastery 3.18.4。lockfile 全家族混装检查和 frozen install 均通过，新增工具运行时 peers 已补齐。
- 使用公开附件、消息和工具执行类型，通过 MessageSourceMap 声明 `mobile-mirror` 来源。截图及历史证据图片使用该来源；取消或保存失败不会发布半成品上下文，纯查询不新增图片。
- 使用模型目录中的 image-capable `deepseek-flash` 和 text-only `deepseek-v4-pro` 验证 omission projection。
- Web 默认 live HMR；startup-only 用 argv patch 禁用 `hmr` 行，不使用已移除的 profile `patchReload` 字段。热重载替换整行 config，应保留完整安全配置。
- 仍由共享 command/core 负责设备控制；DSH adapter 只注册二十个工具及投递离散附件。设备 provider、连续媒体路径和 Agent loop 未改动。

## 工程与打包验证

| 验证 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` / `pnpm peers check` | 通过；无 peer 问题 |
| `pnpm check` | TypeScript、contract lint、108 个文件 / 948 项 Vitest 通过 |
| `pnpm test:e2e` | 80 项 Chromium 通过，1 项按测试条件跳过 |
| `pnpm build` / `pnpm pack:check` | 通过；构建 113 个文件 |
| `openspec validate --all --strict` | 49 项通过 |
| `git diff --check` | 通过 |
| 候选包独立 pnpm 前缀 | `pnpm add --ignore-scripts` 与 `pnpm peers check` 通过，无 peer 问题 |
| 同包独立 CLI/Viewer/MCP | checksum、clean prefix、二十工具、Viewer 双语与关闭通过 |
| 同包独立 DSH clean profile | Native/PTC × live/startup、二十工具和 Mock 生命周期通过 |

`scripts/dsh-clean-profile-probe.mjs` 用隔离的 DSH_HOME 和临时 loopback 端口安装候选包，验证：

1. 不满足 DSH peer 的负例被宿主拒绝；无需版本豁免。
2. Native/PTC 的注册测试、历史图片证据、diagnostic/triage、acceptance、外部结果授权/撤销与双 Mock 矩阵。
3. live HMR 配置从 750 ms 切换到 375 ms；非法 YAML 产生宿主重载失败事件，Viewer 保留 375 ms；恢复文件后回到 750 ms，工具恢复为二十项且没有重复 listener。
4. 每个宿主发 SIGTERM 后正常退出（exit 0），Web 和 Viewer 端口均释放。探针不以业务完成日志替代退出/资源证据。
5. 模型图片/纯文本目录与真实消息投影边界，不发送 provider 请求。

最终候选包的 SHA256、各探针原始摘要和本机升级记录保存在此 worktree 的 `openspec/changes/upgrade-dsh-020-rc2/implementation-validation.md`；该记录不进入候选包，避免更新验证哈希时改变被测 tarball。

## UI 操作契约

完整 E2E 覆盖操作中局部进度、其他控件可交互、失败后保留材料与取消。另顺序重跑 `workbench.spec.ts` 的 slow failing source 和 long flow 场景，两项均通过。保留并人工查看当前截图：

- `artifacts/dsh-020/workbench-progress.png`：运行/取消反馈、旧设备画面、主题和历史控件保持可用。
- `artifacts/dsh-020/workbench-retained-failure.png`：取源失败后保留 PNG、显示阶段耗时和局部错误，其他设备控件可用。

初次并行跑单元测试与 E2E 时，E2E 重写公共截图造成哈希检查失败；恢复既有基线后全量检查通过。补充截图与打包重建重叠时出现一次页面初始化超时，顺序重跑通过。历史截图像素和旧验收记录保留原状。

## 验证边界

这是工程、Mock 与打包宿主兼容验证。未重跑真实模型图片消费、物理设备业务、OCR 质量或独立用户验收；历史 rc.8/provider、MCP/真机证据不升级为 0.2.0-rc.2 的新验收。外部 Appium 及用户已有 profile 不参与探针。这段记录对应适配分支验证时点；其后已通过 `REDACTED_REVISION` 合入 dev，合并候选重新验证见[合并记录](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)。其中二十工具均指默认集合，修复另有五项 opt-in Preview 工具。合入不等于公开发布。
