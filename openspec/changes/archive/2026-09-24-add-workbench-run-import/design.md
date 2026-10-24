## Context
当前运行历史以目录形式保存在单个 WorkbenchStore 中。真机探针可指定独立 root，因此其结果不会自动出现在常驻 Viewer。直接复制目录绕开产品入口；把完整目录提交 Git 又会引入隐私和仓库膨胀。

## Goals / Non-Goals
目标是让用户把经过脱敏的完成态运行归档导入 Viewer，完整保留步骤结论、错误和登记证据，并能用仓库 fixture 做 Web 回归。非目标是导入任意目录、zip、录像、大型原始真机证据、未完成运行，或自动替用户脱敏。

## Decisions
- 新格式固定为 `format: mobile-mirror-run`、`version: 1` 的 JSON；本次不增加旧格式兼容。
- 归档携带 manifest 与 base64 文件。只接受 manifest 引用的文件，拒绝缺失、重复和多余文件。
- HTTP 请求、文件数、单文件和总解码大小均设上限；文件名沿用证据白名单，拒绝路径穿越。
- 导入时重新生成 runId，清除 parentRunId、suiteId、video、activity 等本机运行关系，标记 `source: import`；原始结论不重算、不包装成 pass。
- 所有内容完成校验后才写入；写入异常清理本次随机 ID 的目录。证据仍由现有读取路径执行 SHA-256 校验。
- UI 使用本机文件选择器读取 JSON，并显式提示归档将保存到本机。导入不要求连接设备，也不占用设备租约。
- 仓库 fixture 使用合成的 1×1 PNG、脱敏 XML/YAML 和失败 manifest，不包含真实设备标识、会话标题或截图。

## Risks / Trade-offs
JSON base64 体积大于二进制包，因此首期上限较小，适合调试样本而非完整录像。归档内容由用户选择，产品只能校验结构与完整性，不能证明其已经正确脱敏；文档必须明确这一边界。
