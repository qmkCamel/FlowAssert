# packaged-workbench-runtime Specification

## Purpose
Define the packaged workbench's self-contained execution dependencies and runtime paths.

## Requirements

### Requirement: Self-contained executor dependency boundary
发布包 SHALL 包含固定版本的工作台执行器及 worker，不依赖安装者配置仓库 override 或引入第二 Appium 控制栈。上游运行语义和许可证 SHALL 保留。
#### Scenario: Install outside repository
- **WHEN** 用户在无仓库配置的临时前缀安装 tarball
- **THEN** MCP 十工具、Viewer asset、原生 YAML 及 DSH rc.1 Native/PTC 正常工作，不需要放宽 exotic 子依赖保护。
