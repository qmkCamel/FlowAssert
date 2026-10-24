# FlowAssert 小范围内测任务卡

这轮邀请 3–5 位开发者或测试维护者，先完成一次 **Mock 成功→故意失败→新运行复验→分享报告**，再选做一个自己的真机流程。当前为 Developer Preview，可陪跑；不承诺任意设备开箱即用。固定流程无需模型、DSH 或手机。

## 从 main 分支启动

本轮直接使用仓库的 **main 分支**，不需要领取独立安装包。依赖由仓库的 `pnpm-lock.yaml` 固定；反馈时附 `git rev-parse HEAD` 的提交 SHA，方便复现。分支会继续更新，一次体验期间先保持当前提交不变。

首轮维护者验证环境：macOS、Node **24.19.0**、pnpm **11.7.0**。其他系统属于待收集反馈的环境；真机另需对应平台工具链。安装时间单独计时，下面的操作时间不含下载或 Xcode/WDA 准备。

仓库当前为私有：参与者须先获得仓库访问权限，并配置 GitHub 的 Git 认证。克隆时遇到权限或认证错误，先联系邀请人确认访问权限。

首次使用，在一个新目录中克隆源码：

```bash
git clone --branch main --single-branch https://github.com/qmkCamel/flowassert.git
cd flowassert
git rev-parse HEAD
mise install
mise exec -- corepack enable
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm peers check
mise exec -- pnpm build
mise exec -- node scripts/mobile-mirror-cli.mjs doctor --operation mock
mise exec -- pnpm start
```

命令逐条执行，安装、peer、构建或 Doctor 出错就停止并反馈，不忽略错误继续启动。`mise install` 安装仓库声明的 Node，`mise exec --` 确保后续命令使用它；没有 mise 时也可以自行准备上述 Node/pnpm 版本并省略该前缀。

之后需要更新时，先退出 Viewer，在干净的源码工作区执行：

```bash
git pull --ff-only
git rev-parse HEAD
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm peers check
mise exec -- pnpm build
mise exec -- node scripts/mobile-mirror-cli.mjs doctor --operation mock
mise exec -- pnpm start
```

如果工作区有自己的修改，先保留并处理修改，不用强制重置。打开终端打印的本机地址；端口占用可用 `mise exec -- pnpm start --port 0` 获取空闲地址，不停止别人的进程。先选简体中文。Doctor 只确认前提，不能证明真实设备已连接。

只想了解流程，可先双击 [离线交互 demo](communications/mobile-mirror-demo.html)。这是预设模拟，不算完成下面的产品内测。

## 首轮任务（目标 15 分钟，尚待独立测量）

1. **连接 Mock。** 在「设备 / Devices」选择 `Mock device · demo`，点击 `Start demo`。不要点击手机画面，保持计数为零。
2. **保存并运行正例。** 进入「用例」的新建页（地址末尾 `/#/cases/new`），点击「载入 Mock 演示」，展开 YAML 并替换成下面的五步任务。内置新建页示例只有两步，不能直接用于本卡第 3 步。确认它是公开演示内容，保存到用例库，执行静态校验，确认本次运行后启动。预计五步通过。展开任一步截图和断言；业务/视觉未配置项应显示未执行，不应被解释成业务通过。
3. **保留一次失败。** 回到设备页停止并重新启动 Mock；回到同一用例编辑器，把 `1 actions received` 改为 `2 actions received`，保存新修订、校验并运行。预计第 4 步失败，第 5 步未执行。进入报告查看期望与实际、对应截图。
4. **复验且保留历史。** 再次停止并启动 Mock，将期望恢复为 `1 actions received`，保存新修订、校验并运行。预计通过。在「运行记录」或用例历史中分别打开失败和新通过记录；刷新后两者仍应存在。启动 App 和重跑不会自动重置 Mock 计数，所以每轮明确停止并重新连接。
5. **分享可读结果。** 在报告的分享区域选择 HTML；先用无附件版本预览，检查省略范围，勾选审查确认后下载。离线打开，确认标有派生/未重新验证。需要展示截图时再选 Mock 图片，检查遮蔽和预览。HTML 用于阅读，不能导入复跑；本机 Viewer 地址不能发给别人当报告。

五步任务 YAML（只用于 Mock，`platform: ios` 不要求 iPhone）：

```yaml
name: Beta Mock task
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

遇到异常保留原失败，不为了完成任务反复修改期望。这里的“2 改回 1”只修正故意制造的错误期望，不能照搬到真实业务。记录卡在哪一步、稳定错误码、是否求助和花费时间；允许以“未完成”结束。

## 选做真机与退出

只选一个有明确初始状态、可重置且不会触发外发/付费的自有测试 App 场景。先按 [Android](android-real-device.md) 或 [iPhone](ios-real-device.md) 准备环境，再选择平台预检、显式检查与连接。iOS 的 Xcode/WDA 签名成本另计。MCP/DSH、AI 恢复、OCR、矩阵和修复 Preview 都不是首轮必做项；真实修复仍默认关闭。

退出前取消运行并等待收敛，停止自有设备会话，然后在 Viewer 终端按 Ctrl+C。保留本机运行记录与配置，不删除整个数据目录；不再使用时可在确认无自己的修改后移除本次克隆的源码目录。真机已发生的操作不会撤销，外部 Appium/签名由原 owner 管理。旧 alpha.1 不能作为 Workbench 数据回退基线。

## 反馈

安装卡住用 [Setup 表单](https://github.com/qmkCamel/flowassert/issues/new?template=setup.yml)，产品行为异常用 [Bug 表单](https://github.com/qmkCamel/flowassert/issues/new?template=bug.yml)。附分支名、提交 SHA、是否存在本地修改、系统与相关工具版本、任务编号、脱敏错误码和求助情况；不要上传原始手机材料、账号/设备标识、Token 或私有路径。

参与者与组织者共同使用 [体验记录模板](beta-feedback.md)。所有尝试都计入分母，不只统计成功者。当前尚无本轮非作者成绩。
