## ADDED Requirements

### Requirement: 检查模式必须保持既有媒体和展示控件独立

Viewer SHALL 在既有stage中集成只读Inspector，保持PNG、MJPEG和WebCodecs的媒体状态机独立运行。Inspector MUST 使用自己的contain截图表面，不修改实时renderer的cover/contain语义、媒体订阅数量、fallback状态或解码器。Fit、50%–200%缩放、语言和主题 SHALL 只重排当前检查表面，不重捕获或改变设备状态。

#### Scenario: Android或iOS视频期间进入检查

- **WHEN** 已有H.264或MJPEG可用且用户进入Inspector
- **THEN** inspection SHALL 显示独立冻结截图，原media流 SHALL 在独立表面继续更新
- **AND** 进入/退出检查 MUST 不调用media重连或改变Agent observation

#### Scenario: 检查期间媒体失败

- **WHEN** 后台连续媒体失效
- **THEN** 原Viewer路径 SHALL 保留最后画面并按原规则回退PNG，检查图/树 SHALL 保持来自原inspection
- **AND** 返回实时后 SHALL 展示当前可用live/fallback状态，不展示残留overlay

#### Scenario: 展示操作不发设备请求

- **WHEN** 用户缩放、滚动、选节点、展开树或切换语言/主题
- **THEN** Inspector SHALL 只执行本地计算与DOM更新
- **AND** 扣除既有实时轮询后新增capture/source/action/session请求计数 MUST 为零

### Requirement: 检查上下文必须只通过 Viewer 投影提供

Viewer `/api/state` SHALL 增加仅本机使用的inspectionContext，streaming时包含不透明generationToken与screenEpoch，其他状态为null；Agent MirrorState/DSH/MCP状态结果 MUST 不因此增加检查身份、节点或截图。Viewer SHALL 以该上下文丢弃跨session结果，且在state失败时不把旧检查称作当前设备状态。

#### Scenario: session被其他入口停止

- **WHEN** Agent停止session且Viewer随后收到非streaming或新的generationToken
- **THEN** Viewer SHALL 清除inspection数据与overlay，不得映射到新session
- **AND** 既有普通实时Viewer最后画面的保留规则 SHALL 不变

### Requirement: 检查静态资源必须在源码和打包入口中一致可用

共享纯查询/几何模块 SHALL 编译为固定同源browser asset。源码dev启动 MUST 自动准备该asset，发布包 MUST 包含其编译结果；Node与browser构建 MUST 不相互清除产物。server MUST 只暴露固定文件而非任意lib路径，browser bundle MUST 不含Node、DSH、MCP或Appium依赖。

#### Scenario: 干净源码与发布包打开检查

- **WHEN** 从没有旧lib产物的源码启动dev，或从临时前缀安装同次tarball启动Viewer
- **THEN** `/inspection-query.js` SHALL 成功加载且与服务端采用等价规则
- **AND** 检查 SHALL 不依赖开发机缓存、外部CDN或未打包文件
