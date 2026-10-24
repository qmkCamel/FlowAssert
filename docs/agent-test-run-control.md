# Agent 运行已登记测试

修复闭环另属 **Preview（默认关闭）**。`agentTestControl` 不自动授权修复：宿主 `repairToolsEnabled` 控制五项修复工具可见性，项目 `repair.enabled` 和登记权限控制准入，范围/执行/安装须分别人工确认；见[修复操作指南](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md)。

更新：2026-10-07，核对 `dev@REDACTED_REVISION`。该能力让 Codex MCP 与 DeepSeek Harness Native/PTC 调用现有 Workbench；它不增加第二套 Runner，也不接受任意 YAML、代码或文件路径。

## 配置

入口默认关闭。宿主配置必须给出绝对项目路径和精确允许集合：

```json
{
  "agentTestControl": {
    "enabled": true,
    "projectPath": "/absolute/path/to/project.json",
    "allowedFlows": ["smoke"],
    "allowedSuites": ["regression"],
    "allowedPlatforms": ["android", "ios"],
    "allowedAppIds": ["com.example.fixture"],
    "sharedEvidence": ["flow", "plan", "extension", "image"]
  }
}
```

`sharedEvidence` 为空时，Agent 只能看到判定和证据元数据。可选值为 `flow`、`plan`、`extension`、`executor-log`、`xml`、`image`。原始日志、XML 和历史图片需要逐类允许；视频始终留在 Viewer。参数是会写入本机受理 journal 的公开测试数据，不得放密钥。

## 五个工具

1. `mobile_mirror_test_catalog`：读取已登记且被平台/App 白名单允许的 flow/suite，并返回 `catalogRevision`。
2. `mobile_mirror_run_start`：使用客户端生成的 `requestId`、目标、revision 和公开参数受理一次执行，立即返回 `executionId`。
3. `mobile_mirror_run_status`：按 executionId 或 requestId 查询阶段、原 verdict/exitCode、case/attempt 和证据校验状态。
4. `mobile_mirror_run_cancel`：显式取消；重复取消或终态取消返回当前状态。
5. `mobile_mirror_run_evidence`：默认分页列元数据；显式允许时读取单个文本或图片。图片经哈希校验与有界派生后使用 MCP image / DSH attachment 投递，JSON 不含 Base64。

推荐调用顺序：

```text
连接设备
  → test_catalog
  → run_start(requestId, target, catalogRevision)
  → run_status(executionId) 轮询到 finished
  → run_evidence(executionId) 列表
  → run_evidence(executionId, artifactId, format) 按需读取
```

`accepted` 只表示请求已持久受理，不表示测试通过。`pass`、`fail`、`recovered`、`cancelled`、`inconclusive`、业务验证与 cleanup 均沿用 Workbench 原判定。

## 幂等、取消与恢复

- 同一项目下，相同 `requestId` 与相同规范化输入返回原 `executionId`；输入不同返回 `mobile_mirror_request_conflict`。
- 项目在 catalog 后变化，新的 requestId 返回 `mobile_mirror_project_changed`，不会启动设备动作。
- 受理 journal 在执行 gate 之前原子落盘。宿主在受理后崩溃，重启记录为 `inconclusive`，不会自动重放。
- 忙时返回 `mobile_mirror_device_busy`，不隐式排队。MCP/DSH runtime 关闭会取消其活动执行并等待 Workbench 清理。
- status 读取紧凑 manifest；读取具体证据时重新核验 SHA-256。损坏材料被拒绝，执行状态持久降为 `inconclusive`。
- 已完成的单流程 Agent 运行在保留独立、已校验终态 journal 的前提下可按显式清理计划移走媒体；journal/requestId 不随媒体删除。清理后 status 保留原 reported verdict，但当前结论降为 `inconclusive`、退出码 2 和 `evidence-unavailable`，同 requestId 重试只返回原受理、不再派发设备动作。旧/不完整 journal 与套件 attempt 引用继续保护媒体，不能据此声称所有 Agent 历史均可清理。

## 设备 owner 边界

带显式 UDID 的新 Appium 真机会话先取得机器本地 `platform + deviceId` claim。claim 与 runs 目录无关，记录 PID 启动身份、nonce 和 session generation；第二个内置 runtime 返回 `mobile_mirror_owner_conflict`，旧 nonce 不能释放新 owner。

崩溃后若无法确认旧会话已清理，系统拒绝自动接管，需要人工结束原 session 并诊断 claim。该协议只约束本工具内置 runtime，不能阻止独立 ADB/Appium 客户端。它不启动共享 daemon，也不把请求转发给另一个 Viewer。

## 当前验收边界

确定性测试覆盖 catalog 漂移、未登记目标、并发幂等、响应重试、三个受理落盘崩溃点、受理后取消、suite/case/attempt、跨 execution 拒绝、证据篡改降级、MCP image、DSH attachment、两个进程竞争和 nonce/PID 复用。Viewer 与 Agent 共用同一历史并显示执行来源，截图见 [`mobile-mirror-agent-run-source.png`](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-agent-run-source.png)。同 tarball 的 MCP、DSH Native/PTC 及 Android/iPhone Fixture 已通过；真实模型理解仍待补证，详见[验收报告](agent-test-run-control-validation.md)。
# 变更验收只读入口

新增 `mobile_acceptance_get({ id, revision? })`；与现有运行授权共用项目、flow/suite、平台、App 和材料分享策略。当前默认集合共 20 个工具，另有 5 个 opt-in Preview 修复工具；本查询不改变既有工具参数。只读元数据，不授予发布权。使用和边界见 [变更验收](change-acceptance-records.md)。
# 新增只读矩阵摘要（2026-10-02）

`mobile_matrix_status({id})` 在 MCP 和 DeepSeek Harness 0.2.0-rc.2 Native／PTC 共用同一服务。须启用 agentTestControl，当前项目摘要与登记配置匹配，且矩阵每个 flow／platform／appId 全部在允许列表。只返回有界状态、各 attempt 验证分项及原因，不返回 UDID、进程、store 路径、图片或截图文字。项目变化或当前来源不可用时拒绝／降级；工具无启动、取消、复跑权限。控制仅走显式授权的本机 [Viewer／CLI](local-device-matrix.md)。现有单设备工具不转向矩阵槽位。
