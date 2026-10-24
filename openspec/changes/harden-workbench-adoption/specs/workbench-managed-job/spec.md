## ADDED Requirements

### Requirement: Explicit managed and attached execution
CLI SHALL 保留 attach 模式并新增显式 managed-job，后者通过现有 LocalDeviceRuntime/协调器/provider 执行登记套件，只绑定 loopback、取得明确设备 claim，不引入第二控制栈。配置路径仅为可信本机 CLI 输入，不扩展 Agent 参数权限。

#### Scenario: Attach to external runtime
- **WHEN** attach 任务完成或客户端退出
- **THEN** 不销毁外部 runtime、会话或驱动进程

#### Scenario: Another owner controls device
- **WHEN** managed-job 在执行前发现 claim 冲突
- **THEN** 拒绝启动设备控制，不排队夺取或杀死原 owner

### Requirement: Bounded shutdown without replay
managed-job SHALL 明确启动、执行、取消、报告、退出清理各阶段预算；SIGINT/SIGTERM/超时停止新派发并有界收敛在途动作，仅清理本任务拥有资源。重启后不自动续跑、回滚或接管身份未知 owner。

#### Scenario: Interrupted after action dispatch
- **WHEN** 设备动作结果未知时收到取消或宿主异常退出
- **THEN** 保留证据与未知状态，不重发动作；正常取消执行有界收尾，异常重启仅提供诊断

### Requirement: Truthful job result and artifacts
job SHALL 独立保存 suite 原结果和 jobExitCode，JSON/JUnit 继续保留 case/attempt 与 recovered/flaky。0 仅代表测试、必需报告和退出清理全部完成；1 表示确定测试失败/recovered/flaky；2 表示基础设施/报告/收尾失败或不确定；130 表示用户取消且有界收尾完成，收尾失败优先 2。

#### Scenario: Test passes but report write fails
- **WHEN** suite 干净通过而报告无法写入
- **THEN** suite 原结果不改，job 标报告失败并退出 2，不宣称整个 job 成功

#### Scenario: No browser recording
- **WHEN** 无头 managed-job 未运行浏览器录像
- **THEN** 明确录像未执行，不虚构归档或把未声明录像缺失当测试成功证据
