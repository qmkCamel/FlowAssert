## Context
@appclaw/core 的 appium-mcp 链在 pnpm 下触发 exotic 子依赖阻塞。根级 override 不随依赖包传播。
## Decisions
core 固定为构建开发依赖，tsdown 显式内联其使用模块；其他直接运行依赖仍外置并显式声明，避免本机 native 模块误入跨平台包。worker 单独构建为 lib/workbench-worker.js；源码测试继续用原脚本，发布运行选择实际构建文件并计算哈希。保留 Apache-2.0 许可与构建来源，不修改上游代码语义。
## Verification
无仓库 override 的临时目录安装同一 tarball，验证工作台 YAML、固定 browser asset、十工具 MCP 生命周期及 clean-profile DSH rc.1 Native/PTC。不得以仓库 node_modules 运行替代安装验收。新版本发布仍另行授权。

## 宿主实测补充
DSH rc.1 拒绝 type 与 oneOf 同时存在的 ValueSchemaSpec；适配层为联合根省略冗余 type，分支与 MCP 契约保留。增加真实 defineTool 注册回归，开发依赖固定 rc.1 scope/llm；不修改 Harness 代码。
