# 工作台维护参考

面向贡献者和环境维护者。首次运行请先看[工作台使用指南](test-workbench.md)；本页保留保存预算、版本约束、探针与历史测量依据。

## 保存预算、迁移与回滚

用例位于运行根目录的 `cases/`，Viewer 受理位于 `authoring-executions/`，两者不混入普通 run 清理。预算为 1000 个用例、每用例 100 个修订、每页 50 条、请求 80 KiB/YAML 64 KiB、catalog 32 MiB、10000 条保留的变更请求身份。目录中未发布到 head 的修订也占预算；达到预算明确拒绝，不静默截断、驱逐身份或自动删除。磁盘未知/不足沿用 256 MiB 安全余量 fail-closed；坏 catalog 不当成空库覆盖。

高级兼容入口为 `#/legacy`；用例创作没有新增宿主工具，当前工具职责见[产品形态](product-shape.md#agent-与控制面)。回滚前停止运行并正常关闭应用，保留用例/修订、journal、manifest 和引用账本，不通过删除目录绕开旧版本校验。用例创作和报告的兼容探针基于迁移前的特定 `dev` 修订，不能外推任意旧版；具体格式、版本与回滚条件见[兼容边界](https://github.com/qmkCamel/flowassert/blob/main/docs/workbench-compatibility.md)。DSH 安装与验证基线见[安装指南](beta-installation.md)。

软件/Mock 与真实设备及用户成效独立验收。双平台历史Fixture创作/新修订复验已有[10月5日证据](physical-validation-2026-10-05.md)，不能外推到真实构建变更、外部项目或独立用户；5人研究未完成，不能宣称达到10分钟首测/30秒定位目标。

## 开发验证

- `pnpm check`
- `pnpm test:e2e`
- `pnpm build`
- `pnpm pack:check`
- `pnpm test:workbench:physical`：需要显式的设备、Appium 与 YAML 环境参数，见脚本头部；记录同 session 运行与媒体增量，绝不自动拉起另一套控制栈。

实现采用 [ADR 0006](decisions/0006-native-yaml-workbench.md)。2026-09-10 的独立框架真机 PoC 不是本次集成版本的硬件验收。

基础工作台历史证据见 [2026-09-14 验证记录](workbench-validation.md)，后续验收入口集中在[能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md)。

## P0 补强：取证进度、耗时与恢复

用户可见的阶段计时、独立 PNG/XML 取证与异常恢复语义统一见[工作台指南](test-workbench.md#p0-补强取证进度耗时与恢复)。维护者按下面的固定输入测量，不把运行结束当作设备进程已清理。

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
