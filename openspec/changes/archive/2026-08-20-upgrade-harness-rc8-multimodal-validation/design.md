## Context

仓库当前同时把 DSH `0.1.0-rc.6` 写入 peer dependency、dev dependency、lockfile、README 和验证矩阵。插件已经能把单帧 PNG 保存为 DSH attachment，并以 deferred `ImageBlock` 追加到上下文；此前真实 DeepSeek 模型首轮可调用 `start → snapshot`，但 rc.6 官方 adapter 在下一轮无条件拒绝图片。rc.8 把图片 attachment 解析和多模态消息序列化加入宿主，不过默认公共 DeepSeek V4 仍是文本模型，因此“升级宿主”和“选择真实图片 provider”是两个独立验收条件。

本次变更只触及 DSH 宿主适配、版本契约和验证资产。`MirrorService`、provider、ObservationStore、MCP adapter、Appium session ownership 与 Viewer 连续媒体边界保持不变。

## Goals / Non-Goals

**Goals:**

- 将所有当前支持基线精确固定为 DSH `0.1.0-rc.8`，避免 `^` 范围静默漂移到未经验证的 preview。
- 证明 packed 插件在 clean rc.8 profile 中可安装、可加载，并保持 Native/Code 两条 observation 生命周期。
- 证明真实图片模型实际读取由 `mobile_mirror_snapshot` 投递的 raster，而不只是接受 attachment 元数据。
- 保留文本模型负向用例和凭据/本机数据脱敏边界。

**Non-Goals:**

- 不修改 DeepSeek Harness agent loop，不为公共 DeepSeek V4 伪造视觉能力。
- 不把模型/provider SDK 引入 `MirrorService` 或核心 provider。
- 不通过 DSH/MCP 传输连续视频，不改变 Android scrcpy 或 iOS WDA MJPEG 设计。
- 不重复物理设备基线；本次以 Mock raster 隔离验证 DSH 多模态链路，既有真机 observation 证据继续单独记录。

## Decisions

### 1. 精确固定 rc.8，而不是使用兼容范围

`package.json` 中 `@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools` 的 peer 约束和开发期 DSH 包必须使用 `0.1.0-rc.8`，lockfile 同步解析为 rc.8。contract checker 同时扫描版本入口和当前基线文档，防止依赖与证据矩阵分叉。

选择精确版本是因为 Harness 仍处于 developer preview，rc.8 的 attachment/message 行为属于宿主协议的一部分。备选方案 `^0.1.0-rc.8` 会允许后续 prerelease 在没有 clean-profile probe 的情况下进入安装图，和项目现有“每次固定升级都做 bundle-load 验收”的约束冲突。

历史验证记录仍保留原运行版本，不做全局替换；README 与 `docs/validation.md` 的“当前基线”新增 rc.8 记录，旧 rc.6 结果保持时间真实性。

### 2. 使用隔离 Profile 验证 packed 产物

先构建并打包当前工作树，再创建临时、可删除的 DSH profile，显式安装 `@deepseek-ai/dsh@0.1.0-rc.8` 和本地 tarball。验证 config dump、八项工具、Native runtime probe、Code runtime probe、listener/process 释放。不得覆盖用户现有 DSH profile，也不得复用仓库源码路径冒充 packed 安装。

### 3. 真实视觉证明使用 raster-only challenge

真实模型会只调用 `mobile_mirror_snapshot` 获取 Mock PNG，不在同一轮调用 `inspect_screen`。探针要求模型描述 PNG 中至少一项未出现在 canonical snapshot JSON 的视觉特征，例如深色背景、彩色主卡片、白色二进制条或绿色状态块；随后模型使用 snapshot 返回的 fresh `observationId` 点击主卡片区域，再 snapshot 并识别视觉变化，最后 stop。

验收同时检查 DSH 事件中的工具顺序、前后 revision、action 成功和最终 idle。自然语言描述只作为“模型读到像素”的证据，结构化工具事件作为“动作闭环”的证据，二者缺一不可。仅检查 HTTP 200、attachment id 或 adapter 序列化不算通过。

### 4. Provider 选择与负向用例分离

正向用例使用 rc.8 支持的 provider adapter，并从模型目录确认 `inputModalities` 同时包含 `text` 与 `image`；还必须以真实请求确认服务端接受图片。优先复用进程环境中已存在的图片模型凭据，不把 secret 写入命令参数、profile 文件、日志或产物。如果当前环境没有可用图片 provider，工程与 runtime gates仍可完成，但真实模型任务保持未完成，不能降级为 Mock LLM。

公共 DeepSeek V4 继续作为文本模型负向证据：不修改目录声明来谎报 `text,image`。如果没有安全可用的 DeepSeek 凭据，使用目录/adapter 契约测试替代网络负向请求，并在验证文档中明确边界。

### 5. 不改变核心与宿主中立边界

rc.8 兼容修改只能位于 DSH adapter、包依赖、探针和文档。核心 observation 仍返回内存 bytes/结构，DSH adapter 继续负责 attachment 与 deferred context，MCP adapter 不依赖 DSH。这样后续宿主版本升级只需要重复 adapter/pack/profile 验收。

## Risks / Trade-offs

- [rc.8 仍是 `next` preview，接口可能继续变化] → 精确 pin、contract gate、clean-profile probe；升级失败时可恢复 rc.6 lockfile 和基线，不修改核心数据模型。
- [模型目录声明支持图片但真实 endpoint 拒绝] → 正向验收必须检查真实响应，provider 拒绝时记录为外部阻塞而不是通过。
- [自然语言视觉描述存在偶然猜中] → 同时要求前后两帧 raster-only 特征、revision 变化和 observation-bound action 工具事件；不把 structure 发送到同一视觉挑战回合。
- [凭据或 profile 泄漏] → secret 仅来自父进程环境，探针输出只记录布尔可用性和 provider/model 标识，临时 profile/产物做敏感字段扫描。
- [当前工作树包含低延迟媒体未完成改动] → 版本升级只修改独立依赖/文档/探针文件，验证报告区分本 change 与媒体 change，禁止覆盖或回退既有改动。

## Migration Plan

1. 更新精确依赖和 lockfile，增加版本一致性 contract test。
2. 修复 rc.8 类型或运行时兼容问题，但保持 DSH adapter 之外的核心接口不变。
3. 运行单测、E2E、build、pack 和 strict OpenSpec validation。
4. 在隔离 rc.8 profile 安装 tarball并执行 Native/Code probes。
5. 在同一隔离 profile 执行真实图片模型闭环与文本模型负向检查，脱敏保存结果摘要。
6. 更新 README/验证矩阵，把 rc.8 标记为后续固定基线；历史 rc.6 记录保留日期与原结论。

回滚时恢复精确 rc.6 依赖与 lockfile，并把 rc.8 记录标为未通过；临时 profile 可直接删除，不影响用户现有配置。

## Open Questions

无。正向 provider 由运行时可用的安全凭据决定，但验收合同固定为“真实 `text,image` 模型”，provider 不可用时保持明确未通过。
