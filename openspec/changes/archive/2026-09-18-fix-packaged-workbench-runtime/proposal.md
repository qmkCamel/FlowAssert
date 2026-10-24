## Why
仓库 override 排除了 AppClaw 独立 Appium 栈，但下游安装不继承 override，Inspector 干净安装验收因此受阻。
## What Changes
- 构建时内联固定 AppClaw 2.7.0 的实际使用模块与 worker，发布包不再依赖 core 的完整设备依赖链。
- 其余运行库显式声明，保留第三方许可证与原始执行器行为；不放宽包管理器保护。
- 同一 tarball 验证 MCP、Viewer asset、YAML 与 DSH Native/PTC。
## Capabilities
### New Capabilities
- `packaged-workbench-runtime`: 独立可安装的固定工作台执行器。
### Modified Capabilities
无。
## Impact
package/build、worker 定位、打包验收脚本及 ADR；不修改 Harness loop 或设备权限。
