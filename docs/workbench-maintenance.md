# 工作台维护参考

面向贡献者和环境维护者。首次运行请先看[工作台使用指南](test-workbench.md)；本页保留保存预算、版本约束、探针与历史测量依据。

## 保存预算、迁移与回滚

用例位于运行根目录的 `cases/`，Viewer 受理位于 `authoring-executions/`，两者不混入普通 run 清理。预算为 1000 个用例、每用例 100 个修订、每页 50 条、请求 80 KiB/YAML 64 KiB、catalog 32 MiB、10000 条保留的变更请求身份。目录中未发布到 head 的修订也占预算；达到预算明确拒绝，不静默截断、驱逐身份或自动删除。磁盘未知/不足沿用 256 MiB 安全余量 fail-closed；坏 catalog 不当成空库覆盖。

旧入口在右上角“测试工作台”（`#/legacy`），旧 YAML、HTTP、CLI 和原有 MCP/DSH 17 工具仍兼容；当前 `dev` 另有 3 个只读工具（`mobile_acceptance_get`、`mobile_external_result_get`、`mobile_matrix_status`），共 20 个默认工具；修复闭环另有 5 个 opt-in Preview 工具。本次用例创作功能未增加宿主工具。回滚前停止运行并正常关闭应用；保留新用例/修订、journal、manifest 和引用账本，不通过删目录绕开旧版本校验。用例创作兼容探针对照 `REDACTED_REVISION`，报告/HTML另对照上一dev `REDACTED_REVISION`；[兼容边界](https://github.com/qmkCamel/flowassert/blob/main/docs/workbench-compatibility.md)限定具体格式与版本，不代表任意旧版安全。DSH 验证版本固定 `0.2.0-rc.2`；合并候选已通过新前缀安装、peer 检查与同包宿主验证，见[记录](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)，不外推任意环境。

软件/Mock 与真实设备及用户成效独立验收。双平台历史Fixture创作/新修订复验已有[10月5日证据](physical-validation-2026-10-05.md)，不能外推到真实构建变更、外部项目或独立用户；5人研究未完成，不能宣称达到10分钟首测/30秒定位目标。

## 开发验证

- `pnpm check`
- `pnpm test:e2e`
- `pnpm build`
- `pnpm pack:check`
- `pnpm test:workbench:physical`：需要显式的设备、Appium 与 YAML 环境参数，见脚本头部；记录同 session 运行与媒体增量，绝不自动拉起另一套控制栈。

实现采用 [ADR 0006](decisions/0006-native-yaml-workbench.md)。2026-09-10 的独立框架真机 PoC 不是本次集成版本的硬件验收。

当前交付证据与硬件边界见 [2026-09-14 验证记录](workbench-validation.md)。

## P0 补强：取证进度、耗时与恢复

步骤详情现在显示执行、定位/读树、坐标校验、设备动作、截图、源树、保存和复核耗时。执行包含设备调用与等待，不能把所有显示值简单相加；“等待与执行器开销”是执行减去设备阶段的差额，包含轮询、IPC 与计算。下一步会等上一检查点落盘后开始，慢取证时仍可切换主题、查看历史和取消。

PNG 与 XML 独立采集并保存。一个失败时仍保留另一个，运行不能通过；取消保留已完成材料，已派发设备操作会先收敛。主机意外退出后，重启会恢复已落盘未登记材料和可能不完整的临时文件，保留原始材料并标明“恢复材料”，结果为无法确认。恢复哈希描述现在找到的字节，不证明中断前材料完整。原有成功运行与重跑关系继续保留。

使用 managed/managed-once Appium 时，断开会核验并清理本次拥有的 Appium/WDA 进程；失败保留可重试的 owner。external/attached 的进程仍由外部 owner 管理。运行结束继续保留会话，不会为了清理而打断实时观看。整个宿主被 SIGKILL 后，材料可在重启时恢复，但不会自动接管遗留设备进程。

### 真机重复测量

保持同一手机、App/驱动版本、YAML、capabilities 和每步 PNG/XML 策略，用以下环境参数执行 `pnpm test:workbench:benchmark`：

- `MOBILE_MIRROR_FLOW_PATH`：用例绝对路径。
- `MOBILE_MIRROR_CAPABILITIES_PATH`：本机私有 capabilities JSON 绝对路径，含明确设备标识，不重置 App 数据。
- `MOBILE_MIRROR_APPIUM_URL`：指定本机 Appium 地址。
- `MOBILE_MIRROR_APPIUM_EXECUTABLE`：可选的可信绝对路径；提供后明确启动 managed Appium，要求端口没有外部 listener。验证 WDA 自动清理时使用此模式。
- `MOBILE_MIRROR_BENCHMARK_OUTPUT`：本机私有结果 JSON 绝对路径。
- `MOBILE_MIRROR_REPEAT_COUNT`：3–10，默认 3；各轮重新建立 session，不把冷启动与暖 session 混成同一种基线。
- `MOBILE_MIRROR_MAX_RUN_MS`：可选的预设耗时门禁；超预算返回非零，不自动扩大门禁。
- Android 继续使用已有 `MOBILE_MIRROR_SCRCPY_PATH` / `MOBILE_MIRROR_SCRCPY_SERVER_PATH`。

报告保留每轮 runId、阶段耗时、媒体、交互、历史、材料哈希复验与 runtime 清理状态；给出样本中位数/p95 和校准用建议预算。三次样本不是生产 SLO，未通过完整验收的轮次不能生成完整基线。2026-09-14 已完成双端各三轮：Android 中位数 45,061 ms / 样本预算 64,828 ms，iPhone 中位数 29,452 ms / 样本预算 42,968 ms；正反例、证据/历史、媒体/交互与资源清理均已复验，见 [P0 验证记录](workbench-p0-validation.md)。
