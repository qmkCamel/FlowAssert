## MODIFIED Requirements

### Requirement: Doctor 必须提供只读、脱敏且可执行的环境报告

`doctor` SHALL 根据显式入口、操作、provider、平台和所选功能检查必要依赖，复用上下文预检契约；无参数仅检查基础运行环境，不再隐式检查 Android/iOS。对真机范围，检查集合 SHALL 包含当前 Node、相关 Appium endpoint/driver、平台命令、设备和获得授权的签名前提；非 DSH 范围 MUST NOT 检查 DSH。报告 SHALL 提供 schemaVersion 2、规范化 context、overall、checkedAt、checks 与功能分项；每项 SHALL 只含稳定 id/status/code、依赖角色、公开版本/计数及静态建议，MUST NOT 包含设备 ID/名称、Team ID、证书/profile、绝对路径、原始 stdout/stderr、环境变量或 stack。

#### Scenario: Android 环境 ready

- **WHEN** 用户显式执行 Android doctor，所需 Appium/ADB 前提可用、UiAutomator2 已安装且至少一个 Android 设备在线
- **THEN** report SHALL 把对应 required checks 标为 pass 并返回该操作的 overall ready
- **AND** 设备结果 SHALL 只含计数与状态；未请求的 iOS/DSH 检查 MUST 不执行或展示，preferred scrcpy 失败 MUST 不阻塞基础连接

#### Scenario: iOS 签名诊断未授权

- **WHEN** 用户执行 iOS doctor 但配置未启用 host signing diagnostics
- **THEN** Xcode/XCUITest 的安全只读检查 SHALL 限于所选范围，WDA 签名/profile 检查 SHALL 标为 manual 并给出显式授权或 Xcode 手工检查建议
- **AND** doctor MUST NOT 绕过授权、访问钥匙串详情或启用 provisioning/device registration；未解决的必要确认 SHALL 使 v2 report 为 incomplete，而非 ready

#### Scenario: 依赖缺失或版本不兼容

- **WHEN** 当前操作的 required command 缺失、必要 external Appium 不可达、driver 缺失、DSH 版本不匹配或 required 媒体不可用
- **THEN** 对应 check SHALL 返回稳定 blocked code，overall SHALL 为 blocked，进程 SHALL 返回 exit code 2
- **AND** doctor MUST NOT 下载、安装、升级、启动或修复依赖；未选依赖 MUST 不影响结果

#### Scenario: Human 与 JSON 输出一致

- **WHEN** 同一依赖注入结果分别使用 human 和 JSON 输出
- **THEN** human SHALL 是同一 v2 canonical report 的确定性投影，明确所选范围及未验证运行项
- **AND** ready 返回 0，blocked/incomplete 返回 2，参数或内部错误返回 1；取消返回 130，不能生成 ready

## ADDED Requirements

### Requirement: Doctor 目标选择必须可预测且说明迁移

CLI SHALL 支持 `--target viewer|mcp|codex|dsh|cli`、`--operation runtime|report|mock|connect|test`、显式 provider/platform 与功能策略。未传操作但显式选择 platform SHALL 视为该平台连接前提检查；无参数 SHALL 只检查基础运行环境。DSH executable/profile 参数 SHALL 仅在 DSH 目标有效。v2 输出、默认范围与退出码变化 MUST 在帮助、安装和诊断文档中明确说明。

#### Scenario: 默认 doctor 不要求手机

- **WHEN** 没有手机、DSH、ADB 或 Xcode 的机器执行无参数 doctor
- **THEN** 系统 SHALL 仅依据 Node、包与基础配置前提返回结果
- **AND** 不得因未选外部依赖产生 warning、manual、skipped 或 blocked 行

#### Scenario: 旧显式平台命令迁移

- **WHEN** 用户执行 `doctor --platform android` 或显式 `--platform all`
- **THEN** 系统 SHALL 检查明确选择的平台，不隐式要求 DSH
- **AND** 输出 SHALL 是标识版本的 v2；文档 MUST 说明旧 JSON 消费者与人工确认退出码的迁移，不能混用 v1 语义
