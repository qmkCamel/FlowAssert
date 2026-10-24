## Context

见 [proposal.md](proposal.md)。`IosWdaPreflightService` 目前并行读取 Xcode、driver、设备、钥匙串身份及本机 profile，并在这些静态检查通过时返回 `ready`。`ConnectionAssistantService.connect()` 随后通过同一个 `MirrorService` 建立 Appium session。真实 session 创建已经是 WDA 可运行性验证，但 Viewer 的助手 HTTP 边界把非助手异常统一压成 `assistant_input_invalid`。托管测试任务也在受理 suite 前先启动设备 session。

## Goals / Non-Goals

**Goals:**
- 本机检查与实际 WDA 启动的状态表述准确；检查操作继续保持只读。
- Xcode 无登录账号的明确上游错误能被识别、脱敏并在 Viewer/其他共享 core 调用方中提供一致操作建议。
- 连接失败时保留原有 session 所有权、取消和重试边界。

**Non-Goals:**
- 读取或管理 Apple ID、Xcode Accounts 数据库、钥匙串密码或 Apple Developer 在线状态。
- 在只读检查阶段偷偷创建 Appium session，或新建第二个 WDA 探针进程。
- 自动签名、更新 profile、注册设备或放宽现有 provisioning 授权。

## Decisions

### 1. 静态预检始终把 WDA 运行标为未验证

在紧凑预检结果增加显式的 WDA runtime 检查状态，并把 Xcode Accounts 登录列入人工项目。Viewer 把静态签名检查和运行验证分别展示。当前 `ready` 仍表示“已检查的本机前提齐全”，不改变旧消费者的枚举值；新增字段说明其范围。相比通过解析 Xcode 私有账号文件推断登录状态，这一做法不会把本地凭据或过期账号信息误认作可用的在线签名权限。

### 2. 复用连接与托管任务现有的 session 启动作为运行验证

用户显式点击连接时才创建 Appium session；托管任务在套件受理前创建 session。session 成功即证明该设备当前的 WDA 运行路径可用。失败直接停在连接/任务启动阶段。相比增加独立的“试探性 WDA session”，此路径不会重复安装、抢占端口或制造第二套资源所有权。

### 3. 在 provider 边界分类，HTTP 边界只投影稳定码

扩展 `classifyWdaStartFailure`，优先匹配明确的 Xcode Accounts/Team 登录错误；缺少 profile、证书身份与设备信任仍走原有分类。分类只依据真实错误文本，不根据静态检查作推断。Viewer 的助手边界允许 `WdaStartError` 以 `{code, 固定 action}` 返回，不透传原始 Appium 错误或脱敏摘要；其他非助手异常仍由现有保守映射处理。Viewer 的英中翻译给出具体 Xcode Settings → Accounts 路径。

### 4. 旧检查响应兼容

新增 iOS 检查项和 preflight 字段不改变 Android/Mock、既有助手输入 schema 或会话行为。运行状态不写进持久配置；连接中 WDA 失败后助手上下文仍按原有单次消费规则处理，用户重新检查再连接。

## Risks / Trade-offs

- [Xcode 文案随版本变化] → 只匹配明确的账号/Team 错误短语；未知情况保留原有 unknown 分类及本机日志排障路径。
- [静态 `ready` 仍可能被旧客户端理解为已可运行] → 同时提供显式 runtime 未验证字段、Viewer 独立检查项并更新文档；不更改旧状态枚举。
- [连接成功只证明当前会话] → 每次新会话继续通过真实 WDA 启动判断，不缓存“永久可用”的成功结论。

## Migration Plan

无配置迁移。新增响应字段由现有客户端忽略；Viewer 使用新字段和稳定错误文案。回退到旧版本后不依赖新增运行状态，原有 session/provisioning 行为不变。
