## ADDED Requirements

### Requirement: Read-only archived screenshot sequence playback

运行分析页 SHALL 在“步骤与证据”视图为已结束运行提供明确标注为“截图序列回放”的只读控件。控件 MUST 包含播放/暂停、上一步/下一步、0.5× / 1× / 2× 速度和当前位置；默认暂停，1× 每步完整显示至少 1.5 秒，其他速度按比例调整。该节奏 SHALL 标注为阅读节奏而非原始执行耗时。回放 MUST 仅使用该运行已登记的历史截图，不触发设备连接、执行、录像、上传或归档判定修改。

#### Scenario: Open and play an archived run without video
- **WHEN** 用户打开包含多个步骤和已登记截图、但没有录像的已结束运行并点击播放
- **THEN** 系统从当前选中步骤开始显示，按记录顺序逐步推进；步骤标题、截图、上下文和当前位置保持对应
- **AND** “该运行未记录可用录像”的事实不阻止截图回放，回放不调用任何设备或运行写入接口

#### Scenario: Playback eligibility and sequence boundaries
- **WHEN** 运行尚未结束、没有步骤或没有任何已登记的完整截图
- **THEN** 播放不可用并显示原因，既有报告阅读功能保持可用
- **WHEN** 只有一个步骤
- **THEN** 仅提供静态浏览并说明没有后续步骤，不产生循环计时
- **WHEN** 多步骤回放已到达最后一步
- **THEN** 显示“回放结束”，提供显式“从头播放”，不自动重播

#### Scenario: Speed and manual controls
- **WHEN** 用户切换速度、暂停或手动选择前后步骤
- **THEN** 速度只影响阅读停留时间；暂停停止后续推进；手动选步先暂停且不自动恢复
- **AND** 首尾边界的前后按钮不可用，步骤列表筛选不改变回放顺序，播放时清除现有筛选以显示完整序列

#### Scenario: Recorded video remains separate
- **WHEN** 用户在同一报告启动截图回放或已录制视频
- **THEN** 另一种播放暂停，避免同时推进；录像缺失不影响截图回放，也不因截图回放自动开始录像

### Requirement: Playback stops at failed steps and unavailable evidence

截图序列回放 SHALL 保留所有记录步骤，不自动跳过失败步骤或无图步骤。失败识别 MUST 与报告现有失败导航一致，包含步骤执行、检查点及已声明步骤检查的失败；运行级失败不得伪造为某一步失败。到达失败步骤 SHALL 展示其证据与原因并暂停。缺失、不可读或无法解码的截图 SHALL 暂停并提供恢复入口，不使用实时画面或其他步骤截图冒充当前证据。

#### Scenario: Stop at failure and explicitly continue
- **WHEN** 自动回放抵达失败步骤
- **THEN** 系统选中该步骤、显示失败上下文和可用截图，并明确提示“已在失败步骤暂停”
- **WHEN** 用户在该失败步骤显式点击继续
- **THEN** 系统允许推进下一步，不因同一已确认失败无限暂停；后续失败仍各自暂停

#### Scenario: Missing or corrupt screenshot
- **WHEN** 抵达无截图步骤，或者截图读取、校验或解码失败
- **THEN** 系统暂停并显示当前目标步骤及不可用原因，保留的上一张可用图片明确标注其原始步骤身份
- **AND** 用户可以重试读取或手动切换步骤；重试成功后保持暂停，只有显式播放才能恢复
- **AND** 缺图本身不改写原运行的通过或失败结论

### Requirement: Playback navigation and loading preserve evidence identity

回放 SHALL 同步可分享的运行/步骤深链接，自动推进不得为每一步新增浏览器后退记录。任何耗时超过 300ms 的取图 SHALL 提供局部加载反馈，保留有身份标签的可用证据，不阻塞暂停、手动选步和离开页面。系统 MUST 等待当前目标图片可显示后再计算下一次停留，防止慢加载跳帧和并发堆积。

#### Scenario: Slow image loading with manual navigation
- **WHEN** 当前回放图片加载超过 500ms，用户暂停或选择另一步
- **THEN** 操作仍可用且立即撤销后续自动推进意图；旧请求迟到不能覆盖新的步骤、图片或播放状态
- **AND** 未显示的目标图片不消耗其阅读停留时间

#### Scenario: Run, tab and page lifecycle
- **WHEN** 用户切换运行、离开“步骤与证据”、使用浏览器前进后退、编辑搜索筛选，或者浏览器页面转入后台
- **THEN** 系统暂停并取消旧推进；返回页面或切回前台不自动恢复播放
- **AND** 不发生跨运行串图、后台计时推进或过期请求恢复播放

#### Scenario: Stable URL and bounded evidence reads
- **WHEN** 用户连续回放一个较长的历史运行
- **THEN** URL 始终指向当前所选步骤而不堆积逐步历史记录，图片按需有界加载，内存中不持续积累完整运行截图
- **AND** 读取继续遵循既有归档访问、完整性校验和读租约边界

### Requirement: Accessible screenshot playback controls

回放控件 SHALL 支持中英文、键盘操作、清晰焦点和可理解的无障碍名称；在 390px 窄屏及 200% 页面缩放下仍可操作。回放状态 SHALL 与截图区域相邻展示，暂停和加载不依赖颜色区分，自动选步不得抢走键盘焦点。

#### Scenario: Keyboard and narrow-screen playback
- **WHEN** 用户在窄屏或 200% 缩放下使用键盘启动、暂停及切换步骤
- **THEN** 控件不被裁切，按钮有清晰名称和状态，失败/缺图暂停可被辅助技术理解
- **AND** 自动推进保持用户当前焦点，现有图片缩放和手动步骤导航仍可使用
### Requirement: Screenshot-centered report workbench
报告 SHALL 以中央历史画面、语义步骤及紧凑摘要构成回放工作台。证据可用性、原始结果、未通过必需检查 MUST 在折叠技术信息时仍可见。详细参数和复跑操作 SHALL 按需展开；复跑 MUST 保留原有确认。

#### Scenario: Read the first screen
- **WHEN** 用户打开桌面报告的步骤与证据页
- **THEN** 首屏可看到历史画面和播放入口，步骤显示记录目标和可用耗时，不以内部 UUID 和技术参数为主要内容
- **AND** 窄屏、键盘和 200% 缩放仍可访问播放、步骤、失败与详情

### Requirement: Linked step timeline and bounded filmstrip
回放 SHALL 提供步骤滑块、失败标记和可展开的窗口缩略图，使用真实步骤顺序而非连续视频时间。手动定位 MUST 暂停并更新步骤/上下文/URL；自动推进 MUST 不堆积浏览器历史。等待折叠和搜索 MUST 不改变原始计数与失败事实。

#### Scenario: Seek with a slow screenshot
- **WHEN** 当前截图读取超过 500ms，用户拖动滑块或点击另一帧
- **THEN** 控件保持响应，旧请求取消，迟到结果不覆盖新步骤；可用旧图保留自身身份
- **AND** 缩略图仅在展开时最多读取当前附近五帧，最多两个并发，取消或离开释放资源

#### Scenario: Failed or missing frame
- **WHEN** 回放到失败或无可用截图步骤
- **THEN** 原有暂停/重试规则保持，时间线仍保留该步骤并用文字区分失败和缺图

### Requirement: Recorded action evidence and before-after inspection
新运行的本机坐标动作 SHALL 有界登记执行前截图、坐标系与实际派发状态，并与本步执行后 checkpoint 关联。读取者 SHALL 可显式暂停并查看前后对照。标记 MUST 只应用于与记录动作绑定且几何验证通过的执行前图；不得根据后图、相邻步骤或实时图推测。

#### Scenario: Inspect a recorded tap or swipe
- **WHEN** 一个新运行记录了有效的动作前图片、匹配几何、真实坐标与派发状态
- **THEN** 用户可并排查看本步动作前与执行后图片，前图展示真实点击点或滑动方向，并显示派发完成/未知等状态
- **AND** 回放阅读本身不派发设备操作

#### Scenario: Missing or mismatched action evidence
- **WHEN** 没有动作证据、图片不可读、坐标越界或几何与图像不匹配
- **THEN** 显示未记录或不可用说明，不绘制推测标记，原始结果和可用执行后图保持可读

#### Scenario: Navigate while the prior comparison is open
- **WHEN** 用户从已展开动作对照的步骤切换至另一步，目标截图尚未完成读取
- **THEN** 旧动作对照控件立即移除，不能重新打开或取消目标步骤读取；旧主图仅以其原步骤身份保留，局部提示显示目标步骤仍在加载
- **AND** 目标截图完成后仅显示目标步骤的对照入口；无动作证据的步骤不得显示前一步的标记

#### Scenario: Auxiliary capture fails
- **WHEN** 动作前辅助截图失败、几何变化或超过有界预算
- **THEN** 记录辅助证据限制而不把它当动作成功；原有动作权限、取消和结果语义仍生效，不保存输入文字为动作字幕
### Requirement: Stable screenshot playback layout
截图序列回放 SHALL 在固定视口和缩放下保持画布与播放工具栏的位置稳定。切步的加载提示、短长字幕、播放/暂停/结束和错误/重试状态 MUST NOT 在普通回放时挤压或移动画布。超长文本 SHALL 保持可读取，不能遮挡画面或控件。

#### Scenario: Delayed frame during continuous playback
- **WHEN** 播放下一步截图超过 500ms 才能完成读取
- **THEN** 显示局部加载状态，上一张截图保留原身份，画布与工具栏的位置和尺寸不变
- **AND** 新图完成解码后替换画面，不出现临时空白或页面滚动跳变，暂停与导航继续可用

#### Scenario: Long captions and localized controls
- **WHEN** 自动播放跨越短长字幕或到达最后一步，桌面/390px/200% 缩放下的状态文案变化
- **THEN** 内容在稳定的区域内展示，画布不因换行而上下跳动，完整字幕可通过键盘读取

#### Scenario: Failed image and recovery
- **WHEN** 当前图片失败、读取被取消或用户重试后成功
- **THEN** 保留有原身份的可用截图并提示目标步骤及恢复方式，错误和重试入口不改变画布位置，迟到响应不能覆盖新步骤
