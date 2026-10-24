## Why
真机探针生成的运行证据保存在独立目录，常驻 Viewer 无法直接回看；手工复制目录既不可审计，也容易把包含设备和业务信息的原始材料提交进仓库。需要一种有界、可校验的脱敏运行归档，让失败场景可进入工作台并成为稳定回归样本。

## What Changes
- 定义 `mobile-mirror-run` v1 JSON 归档，只包含完成态 manifest 与显式登记的证据文件。
- Viewer 增加本机归档导入入口；导入前校验格式、数量、大小、文件名、引用、字节数与 SHA-256，导入后分配新的 runId。
- 提交一份由本次 iOS 历史标题缺口提炼的脱敏最小失败样本，并覆盖失败步骤自动展开、截图、结构和错误展示。
- 原始真机 PNG/XML 继续留在忽略目录，不迁移旧格式，也不接受本机任意路径。

## Capabilities
### Modified Capabilities
- `local-test-workbench`: 增加有界运行归档导入和脱敏回归样本。

## Impact
涉及 WorkbenchStore、Viewer HTTP API、测试工作台 UI、浏览器回归、验证文档和产品 TODO。仅处理用户主动选择的本机 JSON，不访问外部服务，不控制设备。
