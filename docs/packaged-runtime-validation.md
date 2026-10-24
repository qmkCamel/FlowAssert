# 发布包工作台运行边界验收

日期：2026-09-16。对应 `fix-packaged-workbench-runtime` 与 ADR 0006。

> 本文为历史打包快照，旧工具数及 0.1.x 宿主验证不代表最新候选。当前精确 DSH 0.2.0-rc.2 同包范围见[升级合并验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)与[能力表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md)；旧包哈希和当时结果保留。

## 修复与回归范围

- 固定 AppClaw core 2.7.0 改为构建依赖，实际使用的模块打包；原有其余外部运行依赖显式声明，许可证和来源随包分发。使用者不再需要仓库 override，不引入 appium-mcp 的 Git 子依赖。
- 解析与执行线程共用发布 worker 路径；新增真实 tarball YAML 回归抓到了仅源码运行无法发现的解析 worker 路径问题。
- MCP 探针在临时目录运行，证据存储隔离；十工具、summary/find/get/subtree、严格动作和重观察、query 无图片、SIGTERM 清理，以及 Viewer 中英切换均验证。
- 同一安装包执行五步 Mock YAML，下载每份归档截图/源树并校验长度与 SHA-256，结果 pass。这是发布运行回归，真机证据另见视频验收报告。

## 安装边界

使用 Node 24.19.0、pnpm 11.22.0，在仓库外目录安装 tarball。安装显式禁用依赖安装脚本；不放宽 Git/exotic 子依赖保护，不传入仓库 override。DSH 兼容基线固定 0.1.5-rc.2，通过 CLI 创建全新 profile 并安装同一 tarball，不修改 Harness 循环。

## 验收状态

- MCP/Viewer/YAML：十工具、summary/query 无图片增量、严格动作/重观察、五步流程和证据下载校验、国际化、SIGTERM 清理通过。
- DSH 0.1.5-rc.2：同 tarball、全新 profile、Native/PTC 均完成十工具生命周期；目录确认 `deepseek-flash` 支持图片、`deepseek-v4-flash` 仅支持文本，后者投影返回稳定 omission placeholder。未发 provider 请求，因此这不是对真实图片理解能力的验证。
- 实测发现 Inspector 输出 schema 同时声明 type/oneOf 被 rc.1 拒绝；只在 DSH 投影层移除联合根冗余 type，分支及 MCP schema 保留，真实 defineTool 十工具注册加入单测。
- 工程门禁：303 项单测、41 项浏览器 E2E、类型/契约检查、build、pack:check 通过；OpenSpec 1.9.0 全库 strict 24/24。浏览器截图已保留并人工检查。未发布新版本。

验收候选包 SHA-256：`f36d885c95a9b5123d51311e029db59af07ba7764e9cf7bc10f3afe8529c58df`。本机日志与浏览器截图保留于 `artifacts/physical-validation/packaged-runtime-2026-09-16/`，未公开原始手机画面。候选包未经发布，文档收尾不改变已测运行代码。
