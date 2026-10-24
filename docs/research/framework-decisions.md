# 框架选型与决策演变

> 当前状态入口：[能力总表](../capabilities.md)。本文保留原日期的调研/验收快照；截至 2026-09-16，Inspector 十工具与打包宿主已验收 39/39，历史工具数和阶段失败记录不代表当前状态。

整理日期：2026-09-14。本文整合工程内的源码调研、用户验证和真机记录，没有重新核对所有上游最新版本。各框架能力以链接报告的固定版本为证据范围。

当前决策：**FlowAssert 负责设备会话、实时画面、证据和历史；AppClaw 2.7.0 负责受限的原生 YAML 解析与执行；Appium 负责设备控制。** 详见 [ADR 0006](../decisions/0006-native-yaml-workbench.md) 和[当前架构图](../design/mobile-test-workbench-current.md)。

## 同一诉求下的取舍

| 框架/方案 | 对本项目的价值 | 代价与边界 | 当前采用方式 |
| --- | --- | --- | --- |
| Appium / UiAutomator2 / XCUITest / WDA | 复用双端真机控制和已有 session；与 MirrorService 所有权一致 | 签名、OEM 后台限制、驱动升级、截图/源树延迟和残留进程仍需处理；本身不定义业务通过标准 | 唯一默认控制栈，保留 provider 边界 |
| AppClaw 2.7.0 | 原生可读 YAML、结构化 selector/断言、条件等待；已有报告/历史设计可借鉴 | 完整 SDK 路径有另一套 appium-mcp/Appium 生命周期；9 月 10 日 stock iOS 路径曾阻塞；引擎成功不等于证据完整 | 仅使用固定 parser/runner，通过有限 facade 进入 MirrorService；无模型 fallback；未接入整套 SDK/报告系统 |
| Maestro 真机 fork / PR 3100 | 用户已验证 iPhone；本地对照也有成功运行；原生 YAML 用例资产可直接复用 | fork/签名/driver 构建与升级成本；独立控制通道需要交接；YAML 与 AppClaw 不同 | 保留独立 adapter 候选，不承担当前默认执行路径 |
| ViewInspectKit | 树、截图、属性联动；按需查询；target generation 与写租约的交互和边界设计 | App 内 runtime 接入与本项目 Appium 无障碍来源不同；本地源码不能推定公共开源授权 | 借鉴 Inspector 与 observation 查询设计，不复制 SDK/控制栈；详见[专门比较](viewinspectkit-comparison.md) |
| scrcpy 4.1 / WDA MJPEG | 已有双端持续画面，测试运行期间仍可观看 | 媒体与控制要分别计时；MJPEG relay fps 不等于浏览器绘制 fps；单订阅约束影响未来录制 | 本机媒体通道；不经 DSH/MCP 传连续视频 |
| Appium MCP / Mobile MCP | Agent 工具范围、安装与宿主适配的对照基准 | 不能从工具调用成功推断完整测试闭环；需独立审计权限、会话、证据 | 保留[竞品调研](product-landscape.md)，当前复用本项目九工具接口 |
| Midscene 等视觉路线 | 可作为结构缺失页面的候选补充 | 需要独立测准确率、延迟、成本与失败语义；不能直接承担确定性断言 | 仅研究候选，尚未接入 |

组合遵循职责边界：媒体、控制、流程、证据分别可替换，但一次运行只由一套控制栈拥有设备。当前流程不是 AppClaw → Maestro → Appium 的串联，也没有完整嵌入上述产品。

## 为什么与早期方案不同

| 时间/材料 | 当时结论 | 后续变化 |
| --- | --- | --- |
| 2026-08-20/25 [竞品总览](product-landscape.md)、[Maestro/Appium](maestro-vs-appium.md) | 官方支持面快照优先选择 Appium 支撑本地双端真机 | 不能将当时 Maestro 官方限制外推为 fork 无法控制 iPhone |
| 2026-09-09/10 [总体设计](../design/mobile-test-workbench.md) | 用户接受 PR 3100 真机 fork；暂定 Maestro 独立 worker 优先 | 当前默认引擎后来调整，目标中的视频/代码验证仍未实现 |
| 2026-09-10 [第三方 App iPhone 同机对照](../design/sampleapp-iphone-real-device-validation.md) | Maestro fork 有最终 JUnit 1/1；AppClaw 验证变体 12/12，stock 依赖和 WDA 清理暴露问题 | 验证变体成功不代表完整 SDK 开箱即用；不同用例/取证路径不是性能排名 |
| 2026-09-14 [ADR 0006](../decisions/0006-native-yaml-workbench.md) | AppClaw 原生 parser/runner 可通过有限 facade 复用已有 Appium 会话 | 不再需要引入完整 SDK 的第二套服务，减少会话交接；最终结果由本项目证据规则决定 |
| 2026-09-14 [集成工作台真机验证](../workbench-validation.md) | 双端第三方 App正例、故意失败反例、持续画面、历史与哈希复验已完成 | 证明最小闭环；WDA 自动清理、速度、视觉/业务验证仍是 TODO |

## 决策重审条件

- 大量已有 Maestro 原生流程成为主要资产时，重新评估 fork adapter，并验证明确的设备控制权交接。
- AppClaw 固定版本升级时，验证 parser/runner 的严格模式、facade 调用、依赖变化、断言和证据语义，不直接扩大 YAML 白名单。
- 自研 App 需要颜色、布局约束或内部对象属性时，另评估 App 内探针；不能把现有 accessibility 树包装成白盒检查。
- 跨进程/多设备、视觉验证、业务验证、录制进入范围时，分别建立 OpenSpec 和必要 ADR，避免让一个 provider 同时承担所有职责。

下一步优先级及验收入口见 [PRODUCT_TODO](../../PRODUCT_TODO.md)。公共上游入口：[Maestro PR 3100](https://github.com/mobile-dev-inc/Maestro/pull/3100)、[AppClaw](https://github.com/appclawhq/AppClaw)、[Appium](https://github.com/appium/appium)、[scrcpy](https://github.com/Genymobile/scrcpy)。链接是原始材料入口，不表示本次刷新了上游状态。
