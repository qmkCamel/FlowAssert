# FlowAssert

**可重复的移动自动化测试，明确的断言，有据可查的结果。**

[English](README.md) | 简体中文

[快速开始](#快速开始) · [文档索引](https://github.com/qmkCamel/flowassert/blob/main/docs/README.md) · [MCP 接入](docs/mcp-hosts.md) · [参与贡献](https://github.com/qmkCamel/flowassert/blob/main/CONTRIBUTING.md)

FlowAssert 是面向 Android 和 iOS 的本机自动化测试工作台。用可读 YAML 编写流程，实时观看执行，在同一个界面查看截图、断言诊断和运行历史。你可以独立使用工作台，也可以通过 MCP 或 DeepSeek Harness 接入编程 Agent。

> **开发者预览 · `0.1.0-alpha.2`。** 请从源码启动。FlowAssert 尚未发布安装包，也未发布到公共 npm。仓库目前为私有，克隆需要访问权限。独立工作台无需模型凭据或 DeepSeek Harness。

![FlowAssert Mock 工作台：运行结果、步骤证据与实时画面](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/flowassert-workbench.png)

*确定性 Mock 演示，采集于 2026 年 10 月 24 日；此图不代表真机验收结果。*

## 为什么使用 FlowAssert？

- **用例可读。** 用版本化 YAML 描述点击、滑动、等待和明确的断言，固定流程无需每步调用模型。
- **过程可查。** 运行时观看设备画面，结束后逐步检查截图、界面结构、日志和断言诊断。
- **历史保留。** 保存用例修订、比较关联运行，复跑后仍可回看原始失败，新结果不会覆盖旧记录。
- **报告可分享。** 导出 JSON 或经过审查的离线 HTML 报告，明确选择附件并遮蔽图片中的敏感区域。
- **可接入 Agent。** 通过 MCP 提供设备观察与控制能力，单独授权 Agent 执行已登记的测试。

## 快速开始

先用 Mock 跑通一个测试，再连接手机。Mock 不需要 Appium、手机工具链、模型凭据或设备发现。

### 1. 启动工作台

使用仓库固定的源码工具链：**Node 24.19.0**、**pnpm 11.7.0**。安装 [mise](https://mise.jdx.dev/getting-started.html) 后执行：

```bash
git clone --branch main --single-branch https://github.com/qmkCamel/flowassert.git
cd flowassert
mise install
mise exec -- corepack enable
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

如果自行管理 Node，请准备上述版本，省略命令中的 `mise exec --` 前缀。打开终端打印的本机地址，默认是 `http://127.0.0.1:3210`。端口被占用时，可运行 `mise exec -- pnpm dev --port 0` 选择空闲端口。Viewer 支持英文和简体中文。

### 2. 运行第一个测试

1. 在「设备 / Devices」选择 **Mock device · demo**，点击 **Start demo**。先不要操作设备画面，保持动作计数为零。
2. 进入「用例 → 新建用例」（`/#/cases/new`），载入 Mock 演示并展开 YAML 编辑器，用下面的五步示例替换内容。
3. 确认示例仅包含公开演示内容，保存用例，执行静态校验，确认并启动本次运行。预期五步完成，结果为「通过 / Passed」。
4. 展开任一步查看截图和断言诊断。刷新页面后，从运行历史重新打开结果。

```yaml
name: Demo · tap and verify
platform: ios
appId: com.example.mobilemirror.mock
---
- launchApp
- assertVisible:
    text: Hello, harness.
- tap:
    accessibilityId: action-card
- assertVisible:
    text: 1 actions received
- done
```

这是仓库中的 [Mock 示例](https://github.com/qmkCamel/flowassert/blob/main/examples/flows/demo.yaml)，`platform: ios` 不要求连接 iPhone。高级兼容工作台 `/#/legacy` 也可以运行它。

### 3. 查看失败，再次验证

停止并重新启动 Mock，重置动作计数。将 `1 actions received` 改为 `2 actions received`，保存新修订、校验并运行。预期第 4 步失败，第 5 步不执行。在报告中查看期望与实际结果的差异。

再次重置 Mock，把期望改回 `1`，运行新修订。原失败和新通过记录都会保留。重跑或启动 App **不会**自动重置 Mock。这一步仅用于修正故意写错的期望；真实测试出现意外失败时，应先调查原因。

运行期间仍可观看设备画面，也可取消运行；取消不会回滚已经发生的设备操作。完整首次体验与报告分享练习见[内测任务卡](https://github.com/qmkCamel/flowassert/blob/main/docs/beta-start.md)。

## 选择你的使用方式

| 目标 | 从这里开始 |
| --- | --- |
| 连接 Android 或 iPhone | [Android 环境](docs/android-real-device.md) · [iOS / WDA 环境](docs/ios-real-device.md) · [本机 Viewer](docs/local-viewer.md) |
| 编写流程、检查界面元素 | [工作台指南](docs/test-workbench.md) · [Inspector](docs/inspector-validation.md) |
| 阅读、比较和分享结果 | [报告与离线分享](docs/report-reading-and-sharing.md) |
| 接入 Codex 或其他 MCP 客户端 | [MCP 宿主指南](docs/mcp-hosts.md) · [已登记测试执行](docs/agent-test-run-control.md) |
| 集成 DeepSeek Harness | [安装与兼容性](docs/beta-installation.md) |
| 导入报告、核对变更 | [外部测试资产](docs/external-test-assets.md) · [变更验收](docs/change-acceptance-records.md) |
| 探索可选能力 | [运行时断言](docs/runtime-assertions.md) · [本机 OCR](docs/local-region-ocr.md) · [设备矩阵](docs/local-device-matrix.md) |

多数专题指南目前以中文为主，技术概览提供[英文](docs/technical-guide.md)和[简体中文](docs/technical-guide.zh-CN.md)版本。

## 环境与集成

| 入口 | 要求与范围 |
| --- | --- |
| 源码 / Mock | Node 24.19.0、pnpm 11.7.0，无需手机。首次体验的参考环境为 macOS。 |
| Android 真机 | USB 授权、Appium、UiAutomator2 与兼容的 scrcpy。macOS 实测栈：Appium 3.2.0、UiAutomator2 6.8.0、scrcpy 4.1。 |
| iOS 真机 | macOS、Xcode、设备信任、Developer Mode 与签名后的 WDA。实测栈：Appium 3.2.0、XCUITest 10.19.1、WDA MJPEG。 |
| MCP | 兼容的 MCP 宿主，无需 DSH；设备与证据权限分别配置。 |
| DSH 插件 | DeepSeek Harness 精确版本 `0.2.0-rc.2`；模型服务验证与插件兼容性分别计证据。 |

Viewer、MCP server 与 DSH 适配器通过 MirrorService/Appium 共用设备控制。工作台使用固定的 AppClaw 2.7.0 YAML 执行器，无需安装 AppClaw CLI。连续视频留在本机，Agent 工具交换离散观察与控制结果。实现见[架构说明](docs/architecture.md)，环境检查见[预检指南](docs/environment-preflight.md)。

## 当前状态与限制

FlowAssert 目前是面向本机移动测试的开发者预览。依赖某项能力前，请先查看[能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md)。

- **通过有明确范围。** 仅确认已声明的断言与必需证据；视觉、OCR 和业务校验需要显式配置，普通 UI 测试通过不代表这些检查完成。
- **真机需要准备。** 连接可能涉及签名和平台工具链。已有真机结果仅覆盖特定设备与测试场景，不能外推到任意 App、系统或账号。
- **高级能力单独验收。** OCR 批准、双槽真机矩阵、真实业务验证与独立用户研究仍有未完成项。修复能力为默认关闭、需显式启用的预览，使用前阅读[操作指南](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md)。
- **报告保留来源。** 离线 HTML 是派生阅读文档，不能作为测试重新执行；导入外部报告不会启动对应 runner。

本仓库使用独立 Git 历史。较早的报告与截图记录迁移前工作，不代表 FlowAssert 已重新完成验收。带日期的结果与待办见[验证记录](docs/validation.md)、[真机证据](docs/workbench-validation.md)、[运行时门禁证据](docs/runtime-gates-validation.md)及[发布准备清单](https://github.com/qmkCamel/flowassert/blob/main/docs/open-source-readiness.md)。

## 数据与隐私

服务默认仅绑定本机回环地址。原始运行证据默认保存在 `~/.local/share/mobile-mirror/runs/`，该目录名称为兼容已有数据而保留。截图和界面树可能包含页面或账号信息，分享前应检查附件及未遮蔽的像素。本机执行不自动授权 Agent 对外分享证据。详见[安全模型](docs/security.md)。

## 参与贡献

欢迎反馈安装问题、提交可复现的缺陷、改进文档和提供范围明确的补丁。请附提交 SHA、环境与最小复现步骤，移除凭据和私有设备材料。

阅读[贡献指南](https://github.com/qmkCamel/flowassert/blob/main/CONTRIBUTING.md)、[支持指南](https://github.com/qmkCamel/flowassert/blob/main/SUPPORT.md)与[产品 TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md)。敏感问题请按[安全策略](https://github.com/qmkCamel/flowassert/blob/main/.github/SECURITY.md)报告。

在源码目录运行项目门禁：

```bash
pnpm check
pnpm test:e2e
pnpm build
pnpm pack:check
```

## 许可证

[MIT](LICENSE)。第三方声明见 [licenses/NOTICE.md](licenses/NOTICE.md)。
