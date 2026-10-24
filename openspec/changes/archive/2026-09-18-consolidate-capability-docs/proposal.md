## Why

README、产品说明、文档索引、架构与里程碑保留了 Inspector/输入/录像未实现等旧状态，与最新真机和打包验收冲突；缺少可直接编辑的对外介绍稿。

## What Changes

- 增加能力总表，统一四项产品诉求、Android/iOS 验收、模型/宿主与发布边界。
- 同步中英文 README、文档索引、产品形态、当前架构、TODO、里程碑及工具数量描述。
- 添加中文宣传长稿、短稿、演示提纲和事实来源；定位为草稿，不对外发布。

## Capabilities

仅文档收敛，不新增或修改运行时 capability。本 change 使用 skip_specs，不创建虚构的行为 delta。

## Impact

仅修改文档；不改变 DSH/MCP/Viewer API、依赖和发布版本。双端真机证据限定样本，iOS 完整文字正例与 DSH 图片验收仍未完成。私有真机截图保留本地，不纳入宣传素材。
