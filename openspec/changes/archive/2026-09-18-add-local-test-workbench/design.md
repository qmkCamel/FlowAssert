## Context
参见 docs/design/mobile-test-workbench.md 与 2026-09-10 真机对照。用户已要求实现最小闭环；工作区已有变更全部保留。

## Goals / Non-Goals
Goals：连接设备后在同一会话运行原生 YAML、同时观看；支持取消；保存每步状态及关键原图/页面树、用例版本和错误；重启后浏览历史、重跑保留关联。
Non-Goals：本轮不实现完整 Inspector、录制编辑器、Maestro 媒体适配、通用视觉识别、业务后台验证器或多机调度。Android/iOS 共用 provider，但硬件验收只记录实际可用设备。

## Decisions
1. 采用 @appclaw/core 2.7.0 的原生 parseFlowYamlString/runYamlFlow，通过 worker 隔离。移除其未使用的 appium-mcp 传递依赖；不启动 SDK session，不改写 YAML 执行循环。限定结构化 tap/assert/waitUntil，以及 launchApp/wait/swipe/back/bare done；未知能力在任何动作前拒绝，禁止自然语言和模型兜底、文件/环境插值、安装应用。
2. MirrorService 持有唯一 provider，会话内新增运行租约；运行期间拒绝其他控制和 Agent observation，媒体与缓存预览继续。取消终止 worker 后等待已发出的控制请求收敛；会话保留给 Viewer，明确记录 session-retained；不把租约释放称作 WDA 进程已销毁。
3. 每条 worker 事件与工具请求进入同一顺序队列；步骤终态之后、下一次动作之前采集 PNG + source，声明 blockers 使用同次 source 检查；断言重复在检查点 source 上验证。原始 YAML、步骤事件、图/树各自落盘并 hash；原子 manifest 更新；重启将中断运行转为 inconclusive。
4. 最终 verdict 区分 pass/fail/cancelled/inconclusive/evidence-conflict/evidence-contaminated。pass 仅表示声明的 UI 检查与证据已通过，不包含未声明视觉或业务写入；历史页展示验证范围。原图留存不自动证明屏幕无遮挡，blockers 只覆盖已登记条件。
5. 数据保存在本机独立目录（默认用户数据目录，可通过本机 CLI 环境路径覆盖），原图不通过 DSH/MCP 自动发送。运行 API 同源校验、请求限长、路径按白名单寻址，下载验证 hash。不允许 YAML 执行任意代码；代码扩展留给后续独立验证器接口。

## Risks / Trade-offs
- 上游内部子路径 API 漂移 → 精确 pin 并做原生解析/运行合约测试。
- 底层 UI 树与视觉状态不同 → 声明遮挡条件、检查点重验，明确验收范围；未知视觉遮挡不能声称已自动识别。
- 杀 worker 不能撤回已发出的触摸 → 排空服务队列，取消后的 run 不通过，保留不确定性并禁止旧 worker 后续动作。
- 设备暂不可用 → 先完成真实执行器 + 可控 provider + 浏览器闭环，硬件恢复后补实测，不伪造硬件结果。
