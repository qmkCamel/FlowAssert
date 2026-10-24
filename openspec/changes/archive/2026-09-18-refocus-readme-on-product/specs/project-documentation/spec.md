## ADDED Requirements

### Requirement: README 必须作为产品入口
中英文 README SHALL 优先说明 FlowAssert 的产品定位、目标用户、核心价值、产品形态、典型场景、快速体验和当前成熟度。README MUST 明确本机测试工作台基于共享 Device Bridge：Viewer 是人工连接、YAML 测试、证据与历史入口，DSH/MCP adapter 支持 Agent 独立使用设备核心，并可按需打开 Viewer 监督；Codex MUST NOT 被描述为唯一宿主。README MUST 区分工作台 YAML 与 Agent 工具的能力、授权及验证范围，不将已声明 UI 条件通过表述为通用视觉或业务持久化验证。

#### Scenario: 首次访问者理解产品
- **WHEN** 首次访问者只阅读 README 的产品说明和工作方式
- **THEN** 其能够判断产品解决什么问题、由哪些用户入口组成、支持哪些设备以及 Viewer 扮演什么角色
- **AND** 不需要先阅读 Appium capabilities、配置枚举或维护者探针才能理解定位

### Requirement: README 必须保留最低摩擦的产品体验
中英文 README SHALL 保留无需手机、Appium、模型凭据或宿主设备发现的 Mock 快速开始，并 SHALL 展示与当前产品界面相符的 Viewer 截图。快速开始以外的宿主安装、真机签名、原始 capabilities、发布和物理验收命令 MUST 路由到专题文档。

#### Scenario: 用户从产品说明进入 Mock
- **WHEN** 用户希望在理解产品后立即体验
- **THEN** README 提供可复制的源码安装与 `pnpm dev` 路径、loopback Viewer 地址和最小交互说明
- **AND** 用户无需在首页完成 DSH、MCP 或真机配置

### Requirement: 技术内容必须拥有独立入口
仓库 SHALL 提供中英文技术指南，覆盖源码工具链、本地开发、构建打包、测试门禁、运行时探针和技术文档地图。架构、安全、DSH/MCP、Android/iOS、发布和验证细节 SHALL 链接到既有单一事实源，技术指南 MUST NOT 复制完整配置 contract 或物理验收矩阵。

#### Scenario: 贡献者查找工程命令
- **WHEN** 贡献者从 README 选择“技术与开发”路径
- **THEN** 技术指南提供完整的仓库初始化、开发、构建、打包和必需门禁命令
- **AND** 更专业的宿主、平台、安全和验收内容可以从同一指南到达权威专题文档

### Requirement: 中英文产品文档必须保持语义一致
`README.md` 与 `README.zh-CN.md` SHALL 使用同构章节、相同版本和支持边界，并指向等价的目标文档；中英文技术指南 SHALL 覆盖相同工程主题。翻译 MAY 使用自然语言重写，但 MUST NOT 改变平台支持、安全默认值、发布状态或未完成能力。

#### Scenario: 对比两种语言
- **WHEN** 维护者比较中英文 README 与技术指南
- **THEN** 产品定位、核心能力、快速开始、成熟度、限制和下一步入口保持一致
- **AND** 两种语言都能相互切换且所有仓库相对链接可解析

### Requirement: 产品文案必须保留安全和成熟度边界
README SHALL 标明 developer preview、当前版本、已验证基线和主要未完成范围，并 MUST 保留 local-first、loopback Viewer、显式真机授权、连续媒体不进入 DSH/MCP 结果以及不自动修改 Apple/Android 外部状态的边界。README MUST NOT 把 Mock、单设备或假服务器证据表述为广泛生产兼容性。

#### Scenario: 读者评估是否适合生产使用
- **WHEN** 读者查看产品状态与限制
- **THEN** README 清楚区分当前可用能力、已验证的有限设备基线和生产化缺口
- **AND** 读者能够进入里程碑、验证和安全文档查看详细证据
