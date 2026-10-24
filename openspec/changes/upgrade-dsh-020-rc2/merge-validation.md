# DSH 0.2.0-rc.2 dev merge validation

> 提交后复查（2026-10-07）：以下保留合并时记录的门禁结果；本轮对 `REDACTED_REVISION` 及可达历史检查发现本文的本机 executable 路径触发 `absolute-home-path`。当前文档已脱敏，但历史扫描仍失败，不可据下表旧结果宣称当前 public 门禁通过。详见[文档核对](../../../docs/dev-documentation-audit-2026-10-07.md)。

日期：2026-10-07。在独立 worktree 的 `chore/merge-dsh020-dev` 上完成集成，目标为远端 `dev`。

后续公开审核补充：`REDACTED_REVISION` 提交后，最新续验的公共扫描发现本文件探针命令中的本机绝对路径，当前文件和已推送历史均触发规则。当前命令已改成可移植占位符，但历史 finding 不因此消失；不放宽规则、不自动改写历史或强推。因此下面“通过”是集成阶段记录，不代表提交后当前公共门禁通过。详见 [续验对账](../../../docs/physical-validation-2026-10-07.md)。

- dev 基线：`REDACTED_REVISION`。
- 适配提交：`REDACTED_REVISION`。
- 合并方式：保留两个父提交的普通 merge；最终提交及远端 SHA 以 Git 历史为准。
- 唯一冲突为 `tests/workbench-authoring-contracts.test.ts`，同时保留既有 repair 五文件和 DSH 单探针的 named integration baseline；没有重置旧冻结哈希。

## Fresh merged gates

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm check --maxWorkers=2` | TypeScript、contract lint、125 文件 / 1099 项 Vitest 通过 |
| `pnpm test:e2e --workers=1` | 82 项通过、1 项条件跳过 |
| `pnpm build` | 113 个主构建文件；辅助入口也构建成功 |
| `pnpm pack:check` | 通过 |
| `openspec validate --all --strict` | 50 项通过、0 失败 |
| `pnpm public:check` | 通过 |
| `git diff --cached --check` | 通过 |

首轮 E2E 使用两个 worker，81 项通过、1 项跳过、1 项 PNG 初始化可见性超时。该场景单 worker 定向复测通过，随后单 worker 全量 82 项通过。未改代码或放宽断言；超时原因未确认。

保留并查看 `artifacts/dsh-020/dev-merge-repair-progress.png`，展示新 dev 修复流程的 Mock preparing 状态和局部取消/刷新控件。既有 E2E 生成截图已恢复，未刷新历史截图基线。

## Same merged candidate

候选：`flowassert-0.1.0-alpha.2.tgz`，1,988,134 bytes。本机目录：`/tmp/mobile-mirror-dsh020-merge-candidate-4fnrlx9l`。

SHA256：`dc68d2021e5723e2b1863e236dc5364ee1081867dcc224a938ce4bc09bcd40ae`。配套 `merge-candidate.sha256`；两个探针使用同一份 tarball，其间没有重新打包。这份合并记录、checksum 和截图不进入包。

`node scripts/dsh-clean-profile-probe.mjs --dsh <absolute-dsh-executable> --tarball <candidate>`：通过。本机 executable 路径已在 2026-10-07 文档核对时脱敏；实际选择已安装的精确 0.2.0-rc.2 CLI，精确 Node/DSH 版本及原验收结果不变。

```json
{"harness":"0.2.0-rc.2","profile":"clean","peerMismatch":"rejected","patchReload":["live","startup"],"hmr":"valid-invalid-restore-pass","tools":20,"modes":["native","ptc"],"agentTests":"native-ptc-pass","matrix":"dual-mock-native-ptc-pass","modelImageBoundary":"CATALOG_IMAGE_AND_TEXT_ONLY_PROJECTION","signalCleanup":"exit-and-ports-released","lifecycle":"complete"}
```

`node scripts/release-candidate-probe.mjs --tarball <candidate> --checksum <SHA256SUMS>`：通过。首次与宿主探针并行时出现 MCP progress lifecycle 不完整，保留失败日志；宿主结束后同包顺序复测通过。没有改动探针断言或源码，首次失败原因未确认。

```json
{"checksum":"verified","install":"clean-prefix","cli":"0.1.0-alpha.2","mcpTools":20,"viewerLocalization":"ok","signalCleanup":"ok","packagedYaml":"pass-with-evidence-hashes","agentTests":"catalog-flow-suite-cancel-evidence-triage","matrix":"dual-mock-cli-mcp-pass","ocr":"not-requested"}
```

上述包安装和运行、Mock 矩阵及目录投影验证不提供新的物理设备、真实模型图片消费或 OCR 质量验收。

## Preserved local state

主工作区仍为 `dev@REDACTED_REVISION`。原有 24 条状态记录和 46 个文件 SHA256 与合并前一致；远端交付从独立 worktree 完成，不向主工作区应用改动。新全局 DSH 为 0.2.0-rc.2，个人 DSH 配置 14/14 文件哈希仍与升级前备份一致。
