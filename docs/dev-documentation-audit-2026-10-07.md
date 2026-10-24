# dev 整体文档核对与修复 Preview

日期：2026-10-07（Asia/Shanghai）。代码基线 `dev@REDACTED_REVISION`，包括修复合并 `REDACTED_REVISION` 和 DSH 升级合并 `REDACTED_REVISION`。在独立工作树更新文档，主工作区及其未提交材料保持原状；本轮不修改运行代码、OpenSpec 任务复选框或自动归档。

## 检查范围与结论

| 范围 | 同步内容 | 不代表什么 |
| --- | --- | --- |
| 中英文 README、能力表、使用与采用指南 | 修复闭环统一标为 Preview，默认关闭；M1/M2 软件链与 M3 Mock 协议分开说明 | 不宣称无人值守生产修复或真机闭环已通过 |
| 修复操作、ADR、安全和兼容 | 已合入 dev；项目准入/工具可见性/人工审批分开，明确停用、未知安装状态和退出预览门槛 | 统一总开关、Viewer 一键开关仍未实现；页面/loopback 安全修复不受 Preview 开关控制 |
| 架构与宿主工具 | 20 项默认工具，另有 5 项 opt-in 修复工具；补充 RepairCoordinator 与唯一设备 owner 边界 | 工具可见不等于授予执行或审批权 |
| 安装、贡献和支持矩阵 | 精确 DSH 0.2.0-rc.2；新合并候选 peer/同包/四组合 clean-profile 已有独立记录 | 不把旧 peer 失败当成当前阻塞，也不外推其他版本、真实模型或设备 |
| TODO、里程碑与文档索引 | 18 个 active change；17 个仍有待办，DSH 升级 11/11 尚未归档；修复 53/65 | 勾选计数不代替证据审查或归档授权 |
| 对外介绍 | 独立业务 verifier 已实现并有 Fixture 证据；未配置仍为 not-performed | 页面成功不等于真实后端正确，外部项目须自行接入真值 |

历史调研、日期化验收、发布说明及旧包哈希保留原样；可能误读为现状的入口补最新指引。没有重新调研第三方产品、重新执行实际宿主修复交接、调用真实模型、连接真机或完成独立用户验收。iPhone Offline 是 10 月 6 日尝试的记录，不是本轮实时设备诊断。

## 来源与剩余门槛

- [当前能力](capabilities.md)、[产品任务快照](../PRODUCT_TODO.md)、[修复使用范围与升级门槛](evidence-guided-repair-operations.md)。
- [修复安全验证](../openspec/changes/add-evidence-guided-repair-loop/safety-fixes-validation.md)、[修复 53/65 逐项任务](../openspec/changes/add-evidence-guided-repair-loop/tasks.md)。
- [DSH 升级验证](dsh-020-validation.md)、[合并候选同包验证](../openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)。
- [较早的同日文档核对](documentation-review-2026-10-07.md)保留其旧基线、16 项任务和安装失败，不覆盖新结论。

远端 tag 本轮重新查询仍仅发现 `v0.1.0-alpha.1`；源码版本 `0.1.0-alpha.2` 不等于公开 Release 已发布。未重新下载 Release 资产，包可用性以版本对应的正式发布记录为准。

## 本轮验证

旧合并候选验证不冒充本轮重跑。完整工程门禁、源码文档链接和任务计数按实际运行收敛；未完成的验证不填通过。

当前发现一个历史发布阻塞：`openspec/changes/upgrade-dsh-020-rc2/merge-validation.md` 曾包含本机 executable 绝对路径，已进入 `REDACTED_REVISION`。当前文件已改为通用占位符，但普通新提交不能删除历史中的旧内容；未重写历史、force-push、扩大 legacy 豁免或关闭扫描。后续须独立决定历史清理或经明确批准的精确例外策略，在此之前公开门禁继续失败。

首次 `pnpm check --maxWorkers=2` 为 124/125 文件通过、1098/1099 测试通过，唯一失败文件是 `public-readiness.test.mjs`。它扫描时还发现 4 个指向尚未落盘审计页的临时断链，以及上述当前文件/历史路径；审计页补齐、当前路径脱敏后再定向检查，不能隐去首次失败或将该轮写为全绿。

| 实际执行 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，未修改 lockfile |
| `pnpm check --maxWorkers=2` | 类型与 contract lint 通过；1098 通过、1 失败，见上述说明 |
| `pnpm exec vitest run tests/public-readiness.test.mjs --maxWorkers=1` | 4 通过、1 失败；复查只剩 `REDACTED_REVISION` 的历史路径，无当前文件泄漏或断链 |
| `pnpm test:e2e --workers=1` | 82 通过、1 条件跳过；未修改 Viewer 源码或提交生成截图 |
| `pnpm build` / `pnpm pack:check` | 均通过；打包检查不是安装/真实宿主或设备验收 |
| OpenSpec 1.9.0 `validate --all --strict --no-interactive` | 50/50 通过；不改变验收复选框 |
| 源码 Markdown 相对链接检查 | 107 份顶层及 docs 文档、962 个链接目标全部存在；不验证外部网页现状或声称 tarball 包含全部源文档 |
| 活动 tasks 与 TODO 对照 | 18 项逐项一致，修复 53/65、DSH 升级 11/11 |
| `pnpm public:check` | 当前文件已脱敏；历史路径仍阻塞，不放行公开门禁 |
| `git diff --check` | 通过 |

本次仅更新文档，不修改公开扫描规则，不发布 Release、不归档 OpenSpec。测试生成的截图及报告保留在工作树、排除于提交；E2E 改写的公开基线 PNG 已恢复到本轮开始时的已批准版本。最终提交/推送状态以 Git 历史和远端 SHA 为准。
