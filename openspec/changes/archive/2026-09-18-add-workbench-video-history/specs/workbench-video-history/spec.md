## ADDED Requirements
### Requirement: Run-bound auxiliary recording
工作台 SHALL 提供显式录像选项，在派发操作前开始录制当前 Viewer 手机画面，绑定 run 和 session，终态后自动结束。录像状态 SHALL 与断言结论分开，不新增设备控制或声音。
#### Scenario: Run finishes with recording
- **WHEN** 用户勾选录像运行 YAML 并完成测试
- **THEN** 对应 run 保留视频、SHA-256、时间范围及完整状态，其他 run 不得接收该录制。
#### Scenario: Recording interrupted
- **WHEN** 页面隐藏、手动停止、会话变化、资源上限或编码异常提前结束
- **THEN** 保存可用部分并标明部分；无视频则明确失败，不能伪称完整。
### Requirement: Durable verified replay
系统 SHALL 原子保存独立视频索引，避免与步骤 manifest 更新竞争；历史 SHALL 支持重启后回放/下载及步骤时间定位，旧记录保持兼容。
#### Scenario: Replay after restart
- **WHEN** 服务重启后用户打开已保存视频的 run
- **THEN** 视频读取通过 SHA-256 校验并支持 Range，步骤可跳到录制范围内的近似时间，超出范围不允许跳转。
#### Scenario: Missing or corrupted video
- **WHEN** 视频未提交或文件损坏
- **THEN** 明确显示不可用/读取失败，不能提供未校验视频或修改既有 UI 断言通过的含义。
### Requirement: Bounded local archive
上传 SHALL 受同源、会话绑定、格式、136 MiB、互斥和超时约束；重复相同上传 SHALL 幂等，不能覆盖不同内容。
#### Scenario: Save failure and retry
- **WHEN** 保存缓慢或失败
- **THEN** 本地显示进度，其他控件可用，保留已有下载并可重试；失败不会关联到其他 run。
