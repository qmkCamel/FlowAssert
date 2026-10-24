# DSH 0.2.0-rc.2 implementation validation

日期：2026-10-07。分支：`feat/upgrade-dsh-0.2.0-rc.2`。基线：`origin/dev@REDACTED_REVISION`。以下证据为适配完成时的独立 worktree 快照，当时尚未 commit/push、合并 dev 或发布；后续 Git 交付另行核验。

本次 OpenSpec 清单 **11/11** 完成。这是当前宿主工程适配；真实模型图片消费、物理设备业务、OCR 质量及独立用户验收不在本次范围，不以 Mock/目录投影替代这些证据。

## Final candidate

候选：`flowassert-0.1.0-alpha.2.tgz`。这是本机新构建，非公开 Release asset；相同包版本不表示与旧 tarball 字节相同。

SHA256：`352415907a8a518dd7c82645a1ec5fb3836e4df089e0626f8b8b3bb6b3863308`。

存放于本机临时候选目录 `mobile-mirror-dsh020-candidate-t03rFD`；配套 `SHA256SUMS` 已由 release-candidate-probe 核验。下列三个最终探针均使用这一份 tarball，期间无重打包；这份验证记录和任务清单不进入 tarball，因此补充结果不会改变被测包。

## Gates

- `pnpm install --frozen-lockfile`：通过。
- `pnpm peers check`：无 peer 问题。开发/宿主 DSH 家族精确 0.2.0-rc.2，Cordis 4.0.4、Schemastery 3.18.4；测试 runtime 安装器锁定 74 个 DSH 家族包。
- `pnpm check`：TypeScript、contract lint、108 个测试文件 / 948 项 Vitest 通过；最后运行 15:07:56，73.62 秒。
- `pnpm test:e2e`：80 项 Chromium 通过、1 项条件跳过。UI 顺序补测 slow failing source 与 long flow 分别通过。
- `pnpm build`：113 个构建文件；`pnpm pack:check` 通过。
- `openspec validate --all --strict`：49 项通过；本 change 单独 strict 通过。
- `pnpm public:check` 与 `git diff --check`：通过。
- `pnpm add --ignore-scripts <candidate>` / `pnpm peers check`：新独立前缀安装通过，无 peer 问题；没有使用 legacy-peer-deps。以下 prefix MCP 实际调用该前缀安装的候选入口。
- `release-candidate-probe.mjs`：checksum、CLI version/help/default config、独立 MCP/Viewer、注册测试、历史证据/triage、双 Mock 矩阵、信号关闭通过。
- `dsh-clean-profile-probe.mjs`：使用新全局 0.2.0-rc.2 CLI、隔离 DSH_HOME；Native/PTC × live/startup、二十工具、注册测试、图片来源、acceptance、外部授权/撤销、双 Mock 矩阵通过。
- Host peer 负例：仅修改临时安装副本的 DSH tools peer 到 0.1.5-rc.2，宿主拒绝 bundle，随后恢复；没有版本豁免。
- HMR：有效 750→375 ms，非法 YAML 产生公开 logger 重载失败事件，Viewer 保留 375 ms，恢复 750 ms、二十工具无重复 listener。每个宿主 SIGTERM 后 exit 0，Web/Viewer 端口释放。

## Global CLI and personal configuration

已执行 `npm install -g --ignore-scripts @deepseek-ai/dsh@0.2.0-rc.2`；`dsh --version` 为 0.2.0-rc.2。原全局版本 0.1.0-rc.8。核对全局安装树的 278 个 DSH package 记录，均为 0.2.0-rc.2，无混装。

配置备份：`~/.dsh-backups/20261007-145001-before-dsh-020-99fb6c`。备份目录私有，manifest 只记录哈希；14/14 配置文件 SHA256 不变。未启动个人 profile 或替换其中插件，未修改外部 Appium。新全局 CLI 的功能验证使用单独 DSH_HOME。

## Review and retained evidence

源码变化集中在 package/lock、DSH adapter 的公开消息/工具类型、版本/安装/生命周期探针及其回归测试。shared command/core 和二十项工具 schema 保持原冻结哈希；只为宿主 clean-profile probe 增加一个有名称的 integration hash，不整体刷新旧基线。

当前文档和三项主规范同步基线。`add-semantic-agent-actions` 的 Installable bundle MODIFIED block 同步当前共享要求，防止归档时丢弃新场景；未勾选其原有任务或改写旧验收结论。

保留并查看：

- `artifacts/dsh-020/workbench-progress.png`：慢运行期间局部进度、取消、主题/历史可交互。
- `artifacts/dsh-020/workbench-retained-failure.png`：取源失败保留 PNG、阶段耗时及局部错误，设备控件仍可用。
- `artifacts/dsh-020/packaged-mcp-observation.png`：独立 pnpm 前缀中同包 MCP 返回的 390×844 Mock 图像，非 Viewer 页截图。

首轮并行单测/E2E 的截图哈希冲突、过期版本断言及 named integration hash 已修正；短超时单测重跑通过，最终全量检查通过。补充截图遇到与打包重建重叠的页面初始化超时，顺序重跑通过。E2E 改写的其他既有截图已恢复，避免更新历史验收像素。

主工作区仍为 `dev@REDACTED_REVISION`，原有 20 个截图修改和 4 个未跟踪 OpenSpec 目录保留；没有向其应用本次改动。

## Final probe summaries

### Global DSH clean-profile

```json
{"harness":"0.2.0-rc.2","profile":"clean","peerMismatch":"rejected","patchReload":["live","startup"],"hmr":"valid-invalid-restore-pass","tools":20,"modes":["native","ptc"],"agentTests":"native-ptc-pass","matrix":"dual-mock-native-ptc-pass","modelImageBoundary":"CATALOG_IMAGE_AND_TEXT_ONLY_PROJECTION","signalCleanup":"exit-and-ports-released","lifecycle":"complete"}
```

### Clean CLI/MCP release candidate

```json
{"checksum":"verified","install":"clean-prefix","cli":"0.1.0-alpha.2","mcpTools":20,"viewerLocalization":"ok","signalCleanup":"ok","packagedYaml":"pass-with-evidence-hashes","agentTests":"catalog-flow-suite-cancel-evidence-triage","matrix":"dual-mock-cli-mcp-pass","ocr":"not-requested"}
```

### pnpm prefix MCP

```json
{"toolCount":20,"revisions":[2,5],"image":{"width":390,"height":844,"byteLength":2809},"structureNodeCount":5,"viewerLocalization":"ok","signalCleanup":"ok","packagedYaml":"pass-with-evidence-hashes","agentTests":"catalog-flow-suite-cancel-evidence-triage","matrix":"dual-mock-cli-mcp-pass"}
```
