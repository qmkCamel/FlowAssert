## Purpose

在不引入共享 daemon 的前提下，阻止本机不同内置 runtime 因使用不同存储目录而同时拥有同一显式真机，明确正常释放、异常残留和外部控制器不在覆盖范围内的边界。

## ADDED Requirements

### Requirement: Exclusive explicit device claim
所有内置 runtime SHALL 在启动真机控制前取得以平台和设备身份为键的进程间互斥 claim；claim MUST 独立于 runsDir。已有活跃 owner 时第二 runtime MUST 返回 owner_conflict，不启动新的设备控制会话。

#### Scenario: Two different history directories
- **WHEN** 两个进程使用不同 runsDir 连接同一手机
- **THEN** 仅一个成功取得 claim，另一个不派发 Appium 启动或设备动作

### Requirement: Verified release and crash recovery
claim 的创建、失效回收和释放 MUST 串行且校验进程启动身份及 owner nonce；正常释放 MUST 等待所属会话在途动作和资源清理。无法确认 owner 已失效或残留控制已清理时 MUST 拒绝自动接管，不依赖 PID 一项判断。

#### Scenario: Reused process identifier
- **WHEN** 旧 owner PID 已被其他进程复用或身份查询不确定
- **THEN** 系统不根据 PID 单独删除 claim 或杀死该进程，返回可诊断状态

#### Scenario: Old owner cleanup races new claim
- **WHEN** 延迟到达的旧 owner 释放与新 claim 竞争
- **THEN** nonce 不匹配的释放不能删除新 owner 的占用

### Requirement: Honest ownership boundary
系统 SHALL 明确 claim 只约束本工具的内置 runtime，不声称隔离任意外部 ADB/Appium 客户端；首期 MUST NOT 自动连接另一个 owner、迁移活动 session 或启动共享 daemon。

#### Scenario: Existing independent Viewer process
- **WHEN** Agent runtime 尝试接管已被独立 Viewer runtime 占用的手机
- **THEN** 返回 owner_conflict，并指引使用原 runtime 或显式结束其会话，不进行自动接管
