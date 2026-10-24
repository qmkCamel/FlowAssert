## ADDED Requirements

### Requirement: Read-only normalized selector candidates
系统 SHALL 从有效、已脱敏的 Inspector 结构生成当前 YAML 方言支持的定位器候选，显示匹配数、平台类型转换及风险理由；当前唯一不等于跨版本稳定。候选 MUST 不含临时 nodeId、敏感原文、原始 source 或 Agent 授权信息。

#### Scenario: Android role conversion
- **WHEN** 选中节点使用完整 Android platformRole
- **THEN** 候选通过共享转换得到执行器支持的类型并按当前结构验证匹配数，不要求用户手工猜类名

#### Scenario: Ambiguous or stale selection
- **WHEN** 候选匹配多个节点或 inspection 已过期
- **THEN** 提示歧义或要求重新获取，不静默坐标兜底、不延长 TTL 或标为可靠定位

### Requirement: Separate draft and explicit execution
生成动作/等待/断言 SHALL 写入独立草稿，保持 Inspector 点击只读；生成不执行手机动作、不自动保存项目文件或重新捕获页面。初版 SHALL 提供复制/下载并经现有 parser/plan 校验；执行须用户单独明确发起。

#### Scenario: Add selected button to draft
- **WHEN** 用户点击添加点击步骤
- **THEN** 只产生可检查 YAML 草稿，手机不点击、会话和 Agent observation 不变化

### Requirement: Authoring feedback and responsiveness
校验 SHALL 将阻断错误与维护性建议分开，关联源位置；异步校验保留旧草稿并避免迟到结果覆盖新编辑。慢校验 SHALL 符合局部进度、失败保留、完成刷新与无关交互验收契约。

#### Scenario: Draft edited during validation
- **WHEN** 校验期间用户修改草稿并切换主题
- **THEN** 主题可用，旧版本校验不能覆盖新草稿，结果标 stale 或对最新版本重验
