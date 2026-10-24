## ADDED Requirements
### Requirement: Deterministic public text input
工作台 SHALL 支持带结构化 selector 的 type，默认 replace，可选 append，replace 空字符串清空；输入不得绕过 MirrorService provider。
#### Scenario: Fill and clear
- **WHEN** 用户执行已审核的 type 流程
- **THEN** 唯一非敏感且聚焦的输入框按模式修改，并保留步骤截图与结构
#### Scenario: Unsafe or stale target
- **WHEN** 目标歧义、敏感、失焦或 provider 输入失败
- **THEN** 停止运行且不尝试独立 ADB、键盘或模型回退
### Requirement: Business evidence and deliberate failure
业务验收 SHALL 使用明确的用户消息与回复完成条件，并用故意失败反例验证判定及证据。
#### Scenario: AI text acceptance
- **WHEN** 第三方 App AI 文字流程发送固定公开测试句
- **THEN** 核验用户消息和回复完成状态，归档每步证据及运行结果
#### Scenario: Incorrect expectation
- **WHEN** 用例声明页面不存在的预期
- **THEN** 运行不能判为 pass，历史中保留失败断言和证据

### Requirement: iOS multiline input identity
工作台 SHALL 支持 iOS TextView/TextEditor 普通输入，按选中元素身份、类型及几何映射到唯一输入节点，且保留稳定焦点和敏感字段限制。
#### Scenario: Container shares input bounds
- **WHEN** 唯一可编辑输入与非输入容器具有相同边界
- **THEN** 容器不构成输入歧义，只有经焦点验证的目标可输入
#### Scenario: Focus or identity is ambiguous
- **WHEN** 两个输入无法区分，或同边界其他输入聚焦而目标未聚焦
- **THEN** 拒绝输入，不借用其他节点的焦点
