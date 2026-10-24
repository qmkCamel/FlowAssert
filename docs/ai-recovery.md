# 有限 AI 导航恢复

当前为开发预览。确定性恢复控制、YAML、证据、套件/JUnit 和 Viewer 已接入。DeepSeek Flash 真实图片对照与 iOS Fixture 真机恢复矩阵已通过；Android 真机与开源对照 PoC 尚未验收，不能宣传为通用 AI 自动修复。

Android 2026-09-17 更换 PLA110 / API 36 后完整矩阵 36/36 符合预期，402 份证据重启复验通过；内容区域校验未再出现状态栏误拒绝。旧手机 ADB 间歇超时仍单列，开源 SDK 对照仍待完成；见[验证记录](https://github.com/qmkCamel/flowassert/blob/main/docs/ai-recovery-validation.md)。

## 用途与边界

目标未找到且没有派发动作时，在显式策略内采集页面，让模型提出允许候选中的一个节点。工作台复核前景 App、会话、截图/源树、新鲜度和预算后点击，再执行原定断言。正常导航成功不调用模型。

画面复核比较解码后的像素。Android 仅在 XML 中存在唯一的当前 App `android:id/content`、覆盖全宽且上下边距受限、没有可见异包节点时使用其内容区域；目标必须完整位于该区域。无法确认范围时及 iOS 均比较整屏。区域、图片尺寸或内容任一变化均拒绝旧建议；源树、前景 App、会话和新鲜度检查仍保留。原始整屏截图照常外发和归档，观察 JSON 新增 `visual` 区域与 SHA-256，裁剪仅用于派发前比较。它不保证识别所有未知遮挡，也不提供纯坐标恢复。

首期只覆盖导航 tap；提交、发送、删除、支付、输入、系统权限、业务断言失败和 ADB 超时不在恢复范围。没有结构节点的画布不自动点击。当前采用严格画面/结构一致性比较，动画或时钟变化可能导致保守拒绝，不保证动态页面恢复率。

## 用例与可信项目配置

沿用工程双文档 YAML，新增 recover 包装，无版本开关：

```yaml
name: Search navigation
platform: ios
appId: dev.mobilemirror.fixture
---
- recover:
    id: open-search
    policy: fixtureSearch
    step:
      tap: { accessibilityId: recovery.search.old }
    postcondition:
      visible: { accessibilityId: recovery.result }
```

本机项目配置新增 recoveryPolicies 与 recoveryModels。策略登记平台、App、页面范围、候选范围、导航声明与图片外发授权。suggest 只保存建议并保留 fail，auto 才能点击。HTTP 调用只能引用已登记策略，不能提交任意模型地址或代码。恢复选择器首期不接受动态绑定。

以下为 DeepSeek 官方 API 的结构化 HTTP 配置：

```json
{
  "recoveryModels": {
    "vision": {
      "endpoint": "https://api.deepseek.com/chat/completions",
      "model": "deepseek-flash",
      "apiKeyEnv": "MIRROR_DEEPSEEK_KEY",
      "thinking": "disabled"
    }
  },
  "recoveryPolicies": {
    "fixtureSearch": {
      "mode": "suggest",
      "platform": "ios",
      "appId": "dev.mobilemirror.fixture",
      "intent": "Open Search, not Search history",
      "modelRef": "vision",
      "navigationOnly": true,
      "allowImageSharing": true,
      "page": { "text": "Recovery navigation fixture" },
      "allowedTargets": [{ "accessibilityId": "recovery.search.v2" }]
    }
  }
}
```

密钥由启动工作台进程的环境变量 MIRROR_DEEPSEEK_KEY 提供，不放入项目 JSON/YAML。thinking 是可选的显式模型配置；DeepSeek 示例关闭思考以控制短导航请求的延迟。普通屏幕观察权限不等于截图外发授权。敏感输入页面拒绝分享，页面文字没有指令权限。前景 App 不符或页面范围不唯一时拒绝恢复。

## 结果与预算

- 正常完成是 pass；实际恢复且原定验证和清理成功是 recovered，CI 默认退出 1，JUnit 输出 recovered failure，不自动重试。
- 业务 verify 失败仍 fail；未知动作结果为 inconclusive 并禁止继续控制，只读取证仍可进行。
- 原 failed step 留存，通过 recoveredBy 关联 aiRecovery；原 recovery 字段仍专指中断后证据材料恢复。
- 留存图片、源树、候选、策略、模型引用、结构化建议/拒绝原因、前后步骤证据、动作派发日志和实际可得的 token 用量；未知用量不填零，不保存隐藏思维链。
- 重启后复核哈希；证据损坏将 recovered 套件降为 inconclusive。重跑不会复用历史建议。

每 run 一次尝试、一次动作；最多两次模型请求，第二次只用于动作前页面变化后的重新规划。每请求 10 秒、恢复共 30 秒，cleanup 有独立期限。HTTP 请求最多 1024 输出 tokens，结构化结果最多 8 KiB，图片最多 2 MiB、候选最多 100 个且候选 JSON 最多 64 KiB。

2026-09-17 用户将后端改选为 DeepSeek API，使用支持图像的 deepseek-flash；原输出 token、次数、时限与字节上限均保留，Codex 预算调整问题取消。依据：[图像输入](https://api-docs.deepseek.com/guides/vision/)、[思考开关](https://api-docs.deepseek.com/guides/thinking_mode/)。

## 验证入口

[本轮验证记录及受控 runId](https://github.com/qmkCamel/flowassert/blob/main/docs/ai-recovery-validation.md)。

- `pnpm exec tsx scripts/recovery-deepseek-probe.ts`：真实 API 图片左右交换与无目标弃权对照，需进程环境密钥；只发送合成图片，不操作设备。
- `pnpm exec tsx scripts/recovery-controlled-probe.ts --deepseek`：真实模型加模拟设备的恢复/归档闭环；不带参数仍为确定性测试 planner。报告明确记录 realModel 与 physicalDevice。

- `tests/workbench-recovery.test.ts`：正常零模型、保留失败、不重放前序动作、越界建议、suggest、取消/迟到、未知写入、套件非零和证据损坏。
- `tests/e2e/recovery.spec.ts`：慢模型期间其他控件可用、原失败可见、重启回看；[截图](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-ai-recovery.png)使用测试 planner，不是真实模型证据。
- Fixture App 新增 Recovery Lab 的十种合成导航页面，两端已完成真实模型每场景三轮矩阵，并补 suggest/normal 边界；SDK 对照仍待验。
- `scripts/recovery-physical-probe.ts`：从显式能力配置选择 Android/iOS，仅允许已安装的 Fixture，归档真机截图、模型建议、实际派发及重启哈希验证；不自动安装或重置手机。RECOVERY_SCENARIOS=suggest,normal 可单独补测边界，默认每场景三轮。
- [设计](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-bounded-ai-recovery/design.md)、[实施任务](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-bounded-ai-recovery/tasks.md)。
