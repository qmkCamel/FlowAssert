## Context

DSH `0.1.2-rc.1` 是截至 2026-09-07 npm 可安装的最新预发布版。其根包要求同版本的 attachment/llm/tools，并使用 Cordis `^4.0.2` 与 Schemastery `^3.18.2`。GitHub 的 `dsh-v0.1.3-alpha.1` 与 `master` 指向更新源码，但相应子包尚未发布到 npm，无法形成用户可复现的 clean-profile 安装。

FlowAssert 只依赖三个公开 seam：通过 `defineTool` 注册九项工具，通过 `saveImage` 保存单张离散观察图，通过 `createUserMessage` 形成 deferred image context。源码比较确认这三个入口在 `0.1.2-rc.1` 到 `0.1.3-alpha.1` 之间保持兼容；新源码对附件/LLM 的主要扩展是通用文件上传和 assistant stream，不要求 FlowAssert 接入。宿主工具呈现枚举则已从旧 `code` 改为 `ptc`，环境变量只接受 `native|ptc|both`。

## Goals / Non-Goals

**Goals:**

- 以精确、公开可安装并完成 clean-profile 验收的 `0.1.2-rc.1` 作为当前支持基线。
- 保持 DSH adapter 薄层和现有九工具/attachment/deferred-context 行为。
- 在 Native 与 PTC 两种呈现方式中证明相同业务闭环。
- 允许 DSH attachment provider 对图片做格式/尺寸归一化，同时保持动作坐标只绑定原始 observation viewport。
- 让依赖、lockfile、README、验证矩阵和 runtime probe 的版本/模式漂移自动失败。

**Non-Goals:**

- 不 patch、复制或扩展 DSH agent loop。
- 不提前支持尚未发布的 `0.1.3-alpha.1`，也不使用子包错误/滞后的默认 `latest` dist-tag。
- 不接入 DSH 新增的通用文件上传；FlowAssert 仍只传递离散图片 attachment。
- 不借本次宿主兼容升级改变 Viewer、MCP 或物理设备 provider 行为，也不重跑未受影响的物理设备验收。

## Decisions

### 1. 支持基线选择 npm `0.1.2-rc.1`，GitHub alpha 只作为观察值

package peer/dev contract 使用精确 `0.1.2-rc.1`，不使用 caret、`latest` 或 Git SHA。精确版本使 release/用户 profile 与 CI 可复现，也避免 DSH 子包 `latest` dist-tag 暂时落后于根包的问题。

依赖刷新会触发 package `prepare`。项目已经要求 Node `^22.19.0 || >=24.0.0`，因此 build 显式选择 tsdown 的 `native` config loader，避免可选 `unrun` 恰好由旧依赖树带入时才可构建；这不改变运行时产物或最低 Node 契约。

文档可以记录 `dsh-v0.1.3-alpha.1` 的源码审阅结论，但 MUST 明确它没有对应 npm 宿主验收，不属于当前支持矩阵。以后升级必须重新执行相同的 pack + clean-profile + Native/PTC + 仓库门禁。

### 2. 只适配呈现模式名称，不改变 PTC 业务调用

探针把 `DSH_TOOLS_MODE=code` 改为 `DSH_TOOLS_MODE=ptc`，输出与文档统一使用 `PTC`。PTC 模式仍调用 DSH 的 `run_code` transport，再由生成的工具绑定进入 FlowAssert 九工具 registry；插件不自行实现代码执行器或绕过完整工具 pipeline。

Native/PTC 都验证 `start → inspect/snapshot → tap_node → replace/append → secure rejection → default-disabled app policy → re-observe → stop`，并要求一次 deferred image context、revision 递增和 stale observation 拒绝。

### 3. 接受 attachment ref 归一化，保留 observation 原始几何

`saveImage` 在 `0.1.2-rc.1` 中可把输入 PNG 归一化为 JPEG/WebP、缩小尺寸并返回 `originalDimensions`。DSH adapter SHALL 把返回的完整 opaque ref 原样交给 `ImageBlock`，不得假设 ref 的 media type/width/height 等于输入图。

工具返回的 `ScreenObservationSummary`、文本说明和后续动作仍引用 capture 时的原始 observation viewport、orientation、revision 与 observationId。attachment ref 的归一化尺寸不得写回 ObservationStore 或用于节点/坐标动作；实际 provider/model 的进一步请求图投影由 DSH attachment/LLM seam 负责。

### 4. 历史证据不可改写，当前事实单独新增

旧 `0.1.0-alpha.1/alpha.2` release 说明和 `docs/validation.md` 中带日期的 rc.8 执行记录是历史事实，不批量替换。当前入口、Target matrix、规格和 active semantic-actions change 改为新基线；验证完成后在 validation 顶部新增 2026-09-07 run，单独写明哪些层实际重跑、哪些层未重跑。

### 5. 验收以打包产物和全新宿主为准

先运行 focused contract/unit test 和 build/pack，再把同一次 `.tgz` 安装进独立前缀中的精确 `@deepseek-ai/dsh@0.1.2-rc.1`。探针使用临时 `DSH_HOME`，完成 plugin add、config dump、Native/PTC runtime，并直接验证公共 text-only model 的目录声明与 `projectImagesForTextModel` 稳定 omission placeholder；它不得发起真实模型请求。退出后清理临时 profile。

这只证明 package/宿主/Mock/负向模型边界，不冒充真实图片模型、Android/iOS 真机或 Viewer 视觉验收。因为本 change 不修改 Viewer，无需产生新的 Viewer 截图。

## Risks / Trade-offs

- [GitHub alpha 比 npm 更快] → 分开记录 observed source 与 supported host，避免不可安装版本进入承诺；发布后再建立新 change。
- [PTC 名称变化导致旧脚本假通过或启动失败] → contract 同时检查探针版本和 `native|ptc` 字面量，并拒绝旧 `code` 分支。
- [attachment 归一化改变图片 metadata] → adapter 原样传 ref，回归测试断言 summary 仍保留原始 observation 几何，动作不读取 ref 尺寸。
- [全仓文档中同时存在 rc.8 与 rc.1] → 只更新 current/support 描述，保留带日期历史记录和 release notes；用新增 validation run解释证据边界。
- [真实 provider/model 行为可能独立变化] → clean-profile 只把 text-only projection计为负向契约；未重新完成真实多模态调用时，不声称该层复验。

## Migration Plan

1. 建立本 change 并让 strict OpenSpec 校验通过。
2. 更新精确依赖/lockfile、版本契约和 Native/PTC 探针，增加 attachment ref 归一化测试。
3. 更新当前入口、主规格和 active semantic-actions change；保留历史记录。
4. build/pack 一次，在独立 DSH `0.1.2-rc.1` prefix/profile 执行 clean probe。
5. 运行全部工程门禁并把实际计数/边界写入 `docs/validation.md`，再完成 tasks。
6. 若 clean probe 失败，恢复支持基线为 rc.8，不发布或声称 rc.1 兼容；临时 profile/前缀可直接删除，无持久迁移。

## Open Questions

无。`0.1.3-alpha.1` 及以后版本必须在 npm 可安装后另行验收。
