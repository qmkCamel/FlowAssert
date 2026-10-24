## Why
手动 Viewer 视频仅留在页面，不能按测试记录检索或关联步骤。需要本机 run 视频归档和历史回放。
## What Changes
- 显式勾选同时录像，在派发 YAML 前启动当前 Viewer 录制，终态后停止并保存至对应 run。
- 保存会话绑定、时间范围、完整/部分/失败状态及 SHA-256，历史页支持视频回放、下载、步骤时间跳转。
- 断开/隐藏/限额结束保留部分录像，上传失败允许重试，重启后读取已保存视频；未收到视频明确不可用。
## Capabilities
### New Capabilities
- `workbench-video-history`: 本机工作台辅助录像及步骤关联。
### Modified Capabilities
无。现有 UI 断言和必需 PNG/XML 证据语义不变。
## Impact
Viewer capture/workbench、WorkbenchService/Store、同源二进制上传/Range 读取、本机文档和自动化验证。不新增设备操作、Agent 工具、麦克风权限或外部服务。
