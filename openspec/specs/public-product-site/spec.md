# public-product-site Specification

## Purpose
定义 GitHub Pages 上的双语产品介绍、浏览器 Mock Playground 与视频入口，让访客无需安装即可理解流程、断言和历史记录，并明确模拟体验与本机产品的边界。

## Requirements

### Requirement: 双语产品入口
公开网站 SHALL 使用与工作台一致的品牌视觉，提供产品说明、Playground、视频、本机快速开始和文档入口。网站 SHALL 支持英文与简体中文，切换语言 MUST 保留编辑内容、进行中的运行和会话历史。直接访问 `?lang=en` 或 `?lang=zh` SHALL 覆盖已保存的语言偏好。

#### Scenario: 运行期间切换语言
- **WHEN** 用户在浏览器 Mock 运行过程中切换中英文
- **THEN** 页面文字与运行状态切换到所选语言，流程继续执行
- **AND** 已编辑的下一次流程与之前的运行记录仍然保留

### Requirement: 受限浏览器 Mock 执行
Playground SHALL 解析用户编辑的 YAML，支持限定的 launchApp、tap action-card、精确文字 assertVisible/assertNotVisible 和末尾 done。实现 MUST 拒绝不支持的命令、参数、应用标识、自定义标签、别名、重复键和超限输入。每次运行 SHALL 从独立零计数状态开始；同一次运行中的 launchApp MUST NOT 清零。此体验 MUST NOT 连接设备、本机服务、模型服务或执行任意脚本。

#### Scenario: 用户改变断言
- **WHEN** 一个仅点击一次的流程声明期望 `2 actions received`
- **THEN** 断言失败，并展示期望文字、实际文字和对应模拟状态
- **AND** 后续步骤标记为未执行，不能伪造通过结果

### Requirement: 非阻塞交互与历史保真
运行 SHALL 有动作附近的进度、重复启动保护与取消入口，其他编辑、语言切换和历史查看 MUST 保持可用。运行 SHALL 使用提交时的流程快照。页面 SHALL 在会话内保留最近八次运行，提供步骤回看和带模拟来源的 JSON 导出；无效输入 MUST 保留此前结果。页面刷新 SHALL 清除会话运行记录，语言偏好 MAY 本地保存。

#### Scenario: 无效输入不覆盖旧结果
- **WHEN** 已有运行结果后用户提交非法 YAML
- **THEN** 显示可恢复的输入错误，保留旧结果与历史

#### Scenario: 取消执行
- **WHEN** 用户取消正在等待派发下一步的运行
- **THEN** 不再执行后续动作，保留已执行的步骤，记录取消状态

### Requirement: 网站原生视频播放
网站 SHALL 提供完整已确认的 46 秒中文配音 MP4、原生播放控件、英文与中文字幕轨道和下载入口。视频 MUST 由同源静态资源提供，使用封面和按需加载，不能自动播放有声内容。网站 MUST 保留视频经过剪辑、来源为 Mock 和产品处于开发者预览阶段的说明。

#### Scenario: 英文访客播放介绍
- **WHEN** 英文访客点击视频播放
- **THEN** 原配音与配乐正常播放，可显示英文字幕并拖动进度

### Requirement: 静态发布边界
构建 SHALL 仅发布网站源码、浏览器依赖及明确选取的已审查媒体至独立目录，MUST NOT 发布完整仓库、运行证据目录或本机配置。Pages 工作流 SHALL 在网站测试通过后只从 main 发布；PR SHALL 运行检查但不部署。相对资源路径 SHALL 兼容 `/FlowAssert/` 项目路径，桌面与窄屏都 MUST 可操作。

#### Scenario: 从仓库路径打开网站
- **WHEN** 访问部署后的 `/FlowAssert/` URL
- **THEN** 页面、YAML 解析模块、视频和字幕均从正确的项目路径加载
- **AND** 无需服务端或用户凭据
