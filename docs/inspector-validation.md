# Observation 查询与 Viewer Inspector 验证

> 当前状态入口：[能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md)。本文保留原日期的调研/验收快照；截至 2026-09-16，Inspector 十工具与打包宿主已验收 39/39，历史工具数和阶段失败记录不代表当前状态。

日期：2026-09-15。实现前基线 `REDACTED_REVISION`，Node 24.19.0、DSH 0.1.2-rc.1；原九工具顺序保留，第十工具追加。语义动作前驱的 Android 输入、交付任务保持原状态。

## 使用

Agent 可调用 `mobile_mirror_inspect_screen({structureMode:"summary"})`，随后使用返回的 observationId 调用 `mobile_mirror_query_screen`：find 按 text/identifier/role/region 筛选，get 查看完整节点，subtree 按深度与 offset/limit 分页。默认 full inspect 兼容旧客户端，includeImage 与结构模式独立。query 不生成图片附件；查询旧观察不会续期或使旧动作绑定重新有效。

Viewer 点击“检查界面”，等待冻结 PNG 和结构整体就绪。点击节点或截图只选择检查目标；详情显示标识、状态、bounds 与父子几何距离。筛选、展开、候选切换、语言与缩放均为本地操作。“重新获取”创建新检查；失败保留仍有效的旧结果。“返回实时”、Stop、会话变化与过期会释放检查数据。

可操作标记不是设备命中保证；缺失属性显示未知；源结构截断时无匹配不能证明整个页面无该节点。父边界距离以 provider 视口逻辑单位表示，不解释为 padding/margin。Inspector 不是 Agent 分享授权入口，截图像素不会自动脱敏。

## 工程与运行证据

- 纯查询覆盖严格参数、AND、字面匹配、未知状态、敏感脱敏、子树/缺失父、环/重复 ID、分页字节预算和几何变换。
- 核心覆盖历史只读与严格动作区别、四条缓存隔离、零额外 provider 请求、慢捕获互斥与 Stop。
- HTTP 覆盖同源/JSON/超限、慢客户端独占发送槽与超时释放、response close 取消、geometry 变化及恢复、PNG 像素预算和固定浏览器资源。
- 浏览器覆盖冻结图/树/详情、失败保留/重试恢复、取消/Stop、390px 下排、DPR2/缩放几何、历史/TTL、键盘、XSS 与上下文断开。
- 命名截图：`mobile-mirror-inspector-final.png`、`mobile-mirror-inspector-narrow.png`、`mobile-mirror-inspector-zoom.png`、`mobile-mirror-inspector-refresh-failed.png`、`mobile-mirror-inspector-recovered.png`。

## 独立阻塞与限制

- Android 首次尝试时无连接设备；2026-09-15 用户连接设备后补验通过，见下方独立记录。
- iPhone 首次尝试：设备配对可见、签名预检 ready，但 lockState 返回 passcodeRequired=true，WDA 建立会话超时，未进入 Inspector。用户解锁后重新执行，结果见下方独立真机记录。
- 默认干净安装：AppClaw 的 appium-mcp 排除规则目前仅在仓库 pnpm override，安装包下游未继承；干净安装会触发 `ERR_PNPM_EXOTIC_SUBDEP`。已向用户说明新增依赖边界修复范围，未放宽安装保护。
- 未执行真实图片模型消费验收，未创建新 tag/Release。

## 本轮结果

- `pnpm check`：38 文件、275 项通过；原全仓历史扫描的 5 秒预算多次超时，只将该 I/O 集成测试预算设为 15 秒，所有扫描范围与断言保留，最终默认 check 通过。
- `pnpm test:e2e`：35/35 通过，包含既有截图/录屏、工作台、Android H.264/iOS MJPEG 模拟媒体与 Inspector；早期测试桩缺少 inspectionContext、新增 fixture 未启动，以及并行 build 清理 browser asset 导致的失败均已定位并复验。
- 500 节点、100 次 warm query：p95 1.53 ms；样本输出 13,015 字节。它是本机测量，不作为每次测试的墙钟断言或真机性能承诺。
- `pnpm build`、`pnpm pack:check`、本 change OpenSpec 1.9.0 strict、`git diff --check` 通过；公开内容扫描通过。
- 临时副本顺序演练：semantic-actions 前驱 +8/~8/-0/rename1，Inspector +22/~3/-0/rename1，均成功；工程中的主规格和 archive 未改变。演练修正了前驱新增 iOS 焦点要求应属 ADDED 的分类错误，没有修改其验收状态。
- 源码纯查询 browser asset 和 Viewer 同源加载已验证；真实 built MCP 子进程完成十工具、summary→find/get/subtree→严格动作→再观察→stop、query 零图片、SIGTERM 清理（输出 toolCount=10、revisions=[2,5]）。这不是临时前缀干净安装；同 tarball MCP/DSH Native/PTC clean-profile 验收仍被安装依赖阻塞，不声明该层通过。

## iPhone 解锁后独立真机验收

- 设备：iPhone 16 Plus / iOS 26.2.1；Appium 3.2.0、XCUITest driver 10.19.1（本机依赖包 appium-webdriveragent 11.1.4）、Xcode 26.6，使用现有已签名 WDA runner（未重新构建，不将依赖包版本当作既有二进制的构建版本），不新增设备注册。
- 场景：系统设置搜索页，输入公开测试标记 `MOBILE-MIRROR-PUBLIC-ACCEPTANCE`，避免以账户首页作为最终验收截图。截图和节点来自真实设备；浏览器使用本地源码 Viewer 与真实 Chrome。
- 通过：冻结 PNG 与节点树、文本筛选、节点详情与 overlay、截图点击候选、重新获取、取消后保留冻结结果、返回实时、再次进入后 Stop 清除图片。未出现几何映射警告，测试文字在停止前清除。
- 正常停止后另查：4723/8100/9100 无监听，devicectl 进程列表无 WDA runner。会话退出本身不作为清理证明。
- 私有证据保留在 `artifacts/physical-validation/iphone-acceptance-2026-09-15/`：`inspector-physical.ts`、`inspector-iphone-report.json`、`inspector-iphone-final.png`、`inspector-processes-after.json`。截图已打开人工检查；原始运行材料保持 Git 忽略，避免公开设备标识。未将此结果扩展为 Android 或打包宿主验收。

## Android 独立真机验收

- 设备：OnePlus 8T / KB2000，Android 14；Appium 3.2.0、UiAutomator2 driver 6.8.0。通过已有 ADB 授权启动 managed 会话。
- 场景：系统设置“显示与亮度”。关闭 USB 用途弹窗后重新捕获；只在 Viewer 内筛选、检查与选点，没有调整亮度或其他设置。
- 通过：冻结截图和结构、文本“亮度”筛选（4 个匹配）、节点详情、节点与父节点 overlay、截图点击候选、重新获取、取消保留冻结结果、返回实时、再次进入检查后 Stop 清除图像。选中节点和高亮节点均为 n10，几何警告为空。
- 首次探针遇到 USB 弹窗；第二次探针在 100ms 筛选防抖完成前选到无 bounds 的根节点。将探针改为等待实际含“亮度”的结果后通过，无需修改产品代码。
- 实时画面实际为 PNG polling fallback；本轮不声明 scrcpy/H.264 路径新增验收。停止后独立查询：4723/8200 无 listener，设备无 UiAutomator2/scrcpy 进程，ADB 转发与测试前一致。
- 已保留并人工查看 `artifacts/physical-validation/android-inspector-2026-09-15/inspector-android-final.png`；同目录含探针、结果 JSON、设备进程和转发前后记录、cleanup-report.json。原始设备材料保持 Git 忽略。

当前 tasks 38/39；仅剩打包宿主干净安装验收（依赖阻塞）。本次按用户要求提交并推送源码与验收文档，不创建发布版本；原始真机材料保持本地留存。

## 2026-09-16 打包验收补齐

此前的安装阻塞已解决，并修复了真实 Harness schema 编译暴露的 Inspector 联合输出类型问题。相同 tarball 在仓库外运行 MCP 十工具/summary-query/无图片增量、Viewer 资源与国际化、YAML 证据校验，以及 DSH 0.1.2-rc.1 全新 profile Native/PTC 均通过。当前任务 **39/39**，详见 [打包运行验收](packaged-runtime-validation.md)。此结论不包含真实图片模型与发布。
