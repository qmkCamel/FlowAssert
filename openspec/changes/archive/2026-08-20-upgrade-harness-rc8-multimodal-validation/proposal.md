## Why

项目仍以 DeepSeek Harness `0.1.0-rc.6` 作为开发、打包和运行时验收基线，因此官方 adapter 会在 deferred `ImageBlock` 进入模型上下文时以 `UNSUPPORTED_CONTENT` 拒绝，无法完成 DSH 宿主内的真实图片消费证明。Harness `0.1.0-rc.8` 已提供多模态消息与图片 attachment 投递能力，需要固定升级并重新验证插件边界。

## What Changes

- 将仓库的 DeepSeek Harness 直接/peer 依赖、lockfile、兼容性检查、示例和当前验证基线统一固定为精确版本 `0.1.0-rc.8`。
- 在隔离 DSH profile 中验证预构建 tarball 的安装、配置、八项工具注册、Native Mode 与 Code Mode observation/action 生命周期。
- 使用明确声明 `text,image` 且真实接受图片输入的模型 provider，完成 `start → snapshot → 模型描述图片 → observation-bound safe action → re-observe → stop` 的真实模型闭环。
- 保留公共 DeepSeek V4 文本模型的负向验收，确保文本模型不会被错误报告为视觉验收通过。
- 更新验证文档，分别记录确定性门禁、DSH runtime、真实模型消费及外部 provider 限制，不把 attachment 保存或 Viewer 可见性冒充模型视觉证明。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `flowassert`：将可安装 Harness bundle 的宿主兼容性和 clean-profile 验收基线固定为 `0.1.0-rc.8`。
- `agent-screen-perception`：把 DSH 图片模型验收从“宿主能力阻塞”更新为必须使用真实图片模型证明图片消费与基于 observation 的动作闭环。

## Impact

- 依赖与发布：`package.json`、`pnpm-lock.yaml`、peer dependency 契约、打包检查。
- 运行时：DSH attachment/message API 兼容性、Native/Code deferred image context、隔离 profile 配置。
- 验证与文档：README、验证矩阵、架构/安全或平台文档中的 Harness 版本基线。
- 安全边界：真实模型凭据仅通过进程环境注入，不写入仓库、profile、日志或验收产物；服务继续默认绑定 loopback，连续视频不进入模型上下文。
