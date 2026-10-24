## ADDED Requirements

### Requirement: 本机检查必须显式获取并与 Agent observation 隔离

Viewer SHALL 提供“检查界面”入口，仅在用户显式进入或重新获取时发起一次本机 inspection。专用 capture SHALL 复用当前 provider/normalizer 与捕获协调，返回独立 inspectionId、generationToken、epoch、时间窗、60秒 expiresAt、PNG 与结构；MUST NOT 发布 Agent observation、生成 attachment、更新 Agent latest revision/epoch/phase 或占用其四条 store 配额。图与结构 MUST NOT 被描述为设备侧原子快照。

#### Scenario: Viewer 不使 Agent 动作绑定失效

- **WHEN** Agent 已有最新可用 observation，用户完成一次 Viewer 检查捕获
- **THEN** Agent 的 observation/revision/TTL/配额 SHALL 保持原值
- **AND** 在原 15 秒 freshness 内，原严格动作 SHALL 仍按原规则执行

#### Scenario: 捕获与身份不可用于 Agent 旁路

- **WHEN** 用户在 mock-only 策略下查看物理设备本机 Inspector
- **THEN** 本机检查 SHALL 可用且明确不会自动发给 Agent，Agent 分享策略 MUST 保持 mock-only
- **AND** inspectionId MUST 无法用于 Agent query/action；不产生 DSH/MCP image 或结构推送

#### Scenario: 自动刷新不得采集结构

- **WHEN** 页面启动、实时帧刷新、语言切换、搜索、展开节点或缩放
- **THEN** Viewer MUST NOT 自动请求 Inspector capture 或 provider source
- **AND** 只有显式进入/重新获取 SHALL 产生本机检查捕获

### Requirement: 本机捕获必须有界、互斥、可取消

Inspector 与 Agent SHALL 共享单捕获 gate 和已有 exclusive queue；已有捕获时第二个捕获 MUST 立即返回 screen_observation_in_progress。Inspector 从调用起总预算 SHALL 为 min(startupTimeoutMs,10秒)，含等待、采集和本机发送。采集 SHALL 为 geometry-before、PNG、source、geometry-after；origin/size/orientation 变化、generation/epoch 变化、取消或超时 MUST 丢弃未发布结果。

#### Scenario: 几何在捕获期间变化

- **WHEN** 前后 geometry 的 viewport 或方向不同
- **THEN** 本次捕获 MUST 返回 `viewer_inspection_geometry_changed`
- **AND** MUST NOT 用新结构替换旧图或猜测旋转变换

#### Scenario: 浏览器取消和 Stop

- **WHEN** 浏览器关闭检查、Abort 请求、连接在 request body 已读完后断开，或用户 Stop
- **THEN** request/response close 与 session signal SHALL 取消 provider 工作并释放临时资源
- **AND** 迟到结果 MUST NOT 发布、恢复面板或进入新 session

### Requirement: 检查 HTTP 必须只在本机同源并限制内存

`POST /api/inspection/capture` SHALL 仅接受精确同源 Origin、JSON `{}`、最多 1 KiB 请求体和无额外查询参数。成功响应 SHALL 一次返回 metadata、规范化 structure 与 image 的 PNG Base64；该编码 MUST 仅用于本机 HTTP。PNG 原始字节 MUST ≤8 MiB、结构 ≤256 KiB、完整响应 ≤12 MiB、解码像素 ≤16,777,216、每边 ≤16,384。Server SHALL 至多保留一个捕获/待发送响应至 finish/close，且不建立可重取图片 store。

#### Scenario: 不可信来源或超限输入

- **WHEN** Origin 缺失、为 null、跨源，Content-Type 不合法，或请求包含额外键/超限内容
- **THEN** server MUST 在 provider 调用前拒绝
- **AND** MUST NOT 返回设备文本、图片、上游 URL 或原始错误

#### Scenario: 超限图片与慢客户端

- **WHEN** PNG/像素/完整响应超出预算，或客户端迟迟不接收响应
- **THEN** 系统 SHALL 以稳定错误或关闭连接停止工作，按总时限释放该请求资源
- **AND** MUST NOT 排队第二个大响应或持久缓存图片

#### Scenario: 成功响应资源释放

- **WHEN** 一次响应发送完毕或连接关闭
- **THEN** server SHALL 释放临时引用并 best-effort 清零自有图片 buffer
- **AND** MUST NOT 新增截图 list/download 目录或把 inspection 响应写盘

### Requirement: 节点必须叠加在同次 inspection 的冻结截图上

检查模式 SHALL 使用独立 PNG contain 表面及节点 overlay，清晰显示检查截图、捕获时间和本机查看边界。PNG decode、结构验证与 generation 校验全部成功前 MUST 保持旧可用结果，不部分更新树或图片。实时 renderer SHALL 继续独立运行，不得使用其帧尺寸替代 inspection 几何。

#### Scenario: 进入检查模式后实时画面变化

- **WHEN** 手机实时视频继续刷新或同 session 出现新 Agent observation
- **THEN** 检查截图与节点 SHALL 保持来自原 inspection
- **AND** MUST NOT 将原 overlay 叠到新视频帧，也 MUST NOT 重建媒体 subscription

#### Scenario: 新图片解码失败

- **WHEN** 重新获取返回结构但 PNG 解码/尺寸验证失败
- **THEN** 新结果 MUST 整体拒绝，旧有效截图、树与 selection SHALL 保留
- **AND** 页面 SHALL 说明仍展示之前的检查结果

### Requirement: 节点查找和选择必须只读且可访问

Inspector SHALL 提供节点树、按 text/identifier 搜索、角色/区域/visible/actionable 过滤、详情、父子导航和几何拾取，并使用共享纯查询规则。节点树初始展开根和第一层，列表每页 50 条。点击图片或节点 SHALL 只改变当前 inspection 的选择，不发送设备动作、不自动打开键盘、不提供编辑/输入/截图导出。

#### Scenario: 点击重叠节点

- **WHEN** 检查截图中的一点同时位于多个节点矩形内
- **THEN** 候选 SHALL 按深度降序、可见面积升序、原数组顺序排列，并允许用户切换候选
- **AND** 任何选择 MUST NOT 被描述为真实原生 hit-test 或调用 `/api/action`

#### Scenario: 键盘、语言与未知值

- **WHEN** 用户仅用键盘搜索、展开、选择或切换语言
- **THEN** tree SHALL 支持方向键/Home/End/Enter/Space，选中与焦点 SHALL 可见，静态文案 SHALL 支持 en/zh-CN
- **AND** 缺失的属性 SHALL 显示未知，语言切换 MUST 不重捕获或清空有效 selection

#### Scenario: XSS 与敏感节点

- **WHEN** 页面节点包含 HTML/script 样式文本或 sensitive=true
- **THEN** 动态文本 SHALL 仅作为 textContent 呈现；敏感 name/text/value MUST 按 normalizer 被移除
- **AND** Inspector MUST NOT 回读原始 source 补齐秘密或声称 PNG 像素已脱敏

### Requirement: 坐标映射必须依据 inspection 的 viewport 与截图

overlay SHALL 使用 inspection 自身 viewport、PNG 尺寸和表面真实 content box 做 contain 映射：先减 viewport origin，再转换为图片像素，再加 contain 偏移与比例。CSS 坐标 MUST 不乘 DPR；bounds 绘制前 SHALL 与 viewport 求正面积交集；命中测试 SHALL 使用逆变换且拒绝 letterbox。图片/viewport 宽高比相对偏差超过1%时 MUST 关闭 overlay/拾取并解释原因，保留图和树的独立查看。

#### Scenario: 缩放、横屏和非零 origin

- **WHEN** 使用非零 viewport origin、横屏、DPR=1/2，或用户在50%–200%间缩放/滚动
- **THEN** overlay SHALL 始终对应冻结 PNG 的实际内容区域，测试误差 SHALL ≤1 CSS px
- **AND** 几何重算 MUST 不请求新帧、source、媒体重连或 Agent observation

#### Scenario: 部分越界与父子距离

- **WHEN** 节点部分超出 viewport 或直接 parent bounds
- **THEN** overlay SHALL 只绘可见交集，详情 SHALL 保留原始 bounds 和相对父边界的有符号几何距离
- **AND** 负值 SHALL 表示超出，缺少 parent/geometry SHALL 表示未知，MUST NOT 把距离命名为 padding/margin

### Requirement: 检查失效必须阻止跨 session 与迟到结果恢复

Viewer SHALL 用独立 capturePhase、snapshotStatus、requestSequence 和 AbortController 管理检查，不复用禁用全局控件的 operationInFlight。后来的 capture 结果 MUST 仅在请求序号、当前 mode 和 generation 匹配时接受。snapshot SHALL 最迟在 captureEndedAt+60秒释放，查询、选择或失败重试不得续期。

#### Scenario: 刷新失败与 TTL

- **WHEN** 同 session 重新捕获失败且原检查未过期
- **THEN** 页面 SHALL 保留原截图、结构与选择并标记获取失败
- **AND** 到达原 expiresAt 时 SHALL 清除检查数据与 Blob URL，显示已过期及重新获取入口

#### Scenario: 动作与 session 变化

- **WHEN** 同 session 的 screenEpoch 改变，或 session generation 被停止/替换
- **THEN** epoch 改变 SHALL 将检查标为历史直到 TTL；generation 改变或非 streaming SHALL 立即清除检查
- **AND** 本页面触发 Stop 时 SHALL 先同步清除，不能依赖 Stop HTTP 成功后才清除

#### Scenario: 网络断开与面板关闭

- **WHEN** state 读取失败，或用户返回实时/pagehide
- **THEN** state 失败 SHALL 标记上下文未确认并阻止新捕获、最多保留至原 TTL；返回实时/pagehide SHALL Abort 并释放全部检查数据
- **AND** 恢复 state 或收到迟到 capture 时 MUST 再验证 generation/requestSequence，不恢复已关闭面板

### Requirement: 检查交互必须保持局部进度和响应式布局

任何可能超过300ms的检查捕获 SHALL 立即显示本地进度，只禁重复捕获；Stop、status、theme、language、zoom SHALL 继续可用。stage宽度≥800px时检查区域 SHALL 使用截图与320px检查面板两列，较窄时上下排列；390px视口不得横向溢出或覆盖控件。截图/tree列表 SHALL 有独立滚动范围。

#### Scenario: 慢捕获期间操作安全控件

- **WHEN** capture 延迟800ms或返回失败
- **THEN** 用户 SHALL 在其完成前切换主题/语言/缩放并可执行Stop，最后有效画面 SHALL 保留
- **AND** 自动化 SHALL 保留成功、失败及实际重试恢复的命名截图并人工检查

#### Scenario: 窄屏与焦点返回

- **WHEN** Viewer 宽度缩至390px或用户Esc退出检查
- **THEN** 检查面板 SHALL 下排且工具栏/Stop可达；退出后焦点 SHALL 回到进入按钮
- **AND** 窄屏、缩放和退出 MUST 不重建设备 session
