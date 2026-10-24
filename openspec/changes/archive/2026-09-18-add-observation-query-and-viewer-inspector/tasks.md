## 1. 基线与契约对齐

- [x] 1.1 复核当前 Git、DSH 0.1.2-rc.1 Native/PTC 与 semantic-actions/zoom/localization 的最新状态；记录本 change 的九工具前驱和按顺序同步策略，不修改前驱未完成真机任务。
- [x] 1.2 在 types/contract 中定义 find/get/subtree 输入、ScreenQueryResult、固定错误和 full/summary 投影；逐项对照 design 第 1–4 节确认默认、字段冲突、字节预算与身份范围。
- [x] 1.3 增加共享 parser 正负样例：未知键、非法分支、字符串边界、offset/limit/depth、缺失 text 的 textMatch/caseSensitive、role/region 枚举；证明 DSH/MCP 等价拒绝。

## 2. 纯查询与只读存储

- [x] 2.1 实现无 Node/DOM/宿主依赖的 screen-query 模块：严格 AND、字面匹配、标识精确匹配、未知属性和原顺序；加入敏感节点/XSS 文本 fixture。
- [x] 2.2 实现层级索引、get、前序 subtree、depth 边界、缺失 parent、重复 ID/环检测；保留原 nodeId，覆盖嵌套与截断结构。
- [x] 2.3 实现摘要字段截断、64 KiB 整体预算、limit/bytes/depth/source 独立标志和 nextOffset；证明跨页无重复、无跳项及超 offset 空页。
- [x] 2.4 为 ObservationStore 增加 getForRead，保留 TTL/逐出/session 错误和旧 getForAction；用 fake clock 证明查询不续期、不改变逐出顺序。
- [x] 2.5 实现 MirrorService.queryScreen 的策略与 actionBinding envelope，按 screen-changed/superseded/action-expired/current 排序；验证读取历史不会放松原 strict action。
- [x] 2.6 在 provider spy 下完成 summary observation 后重复 query、后台慢捕获时 query 和取消/stop 测试；查询新增 provider 请求、revision/epoch 变化及图片数均为零。

## 3. 摘要观察与双宿主入口

- [x] 3.1 增加 inspect_screen 的 structureMode，默认 full 原形状兼容；summary 仅缩减投影，core/store 保留完整规范化结构，includeImage 行为正交。
- [x] 3.2 扩展共享 commands/contract 为十工具，DSH 注册 query JSON data、MCP 注册 text+structuredContent；将三分支 schema 与 output schema 纳入契约校验。
- [x] 3.3 验证 full/summary × includeImage × Mock/物理策略矩阵；query 不调用 saveImage/deferContext、不生成 MCP image/resource，不重写原始 viewport 为 attachment 尺寸。
- [x] 3.4 更新当前 runtime probes 与准确工具数断言，保留旧九工具、action kind、错误/ownership 回归；历史 release 记录不批量替换。

## 4. 独立本机捕获与 HTTP

- [x] 4.1 增加专用 captureViewerInspection 入口和仅 Viewer 可见 generationToken/epoch projection；与 Agent observe 共用捕获互斥/normalizer，保持 Agent store/latest revision/phase 不变。
- [x] 4.2 实现 geometry-before → PNG → source → geometry-after、10 秒总预算、session/epoch/取消检查和临时资源清理；覆盖同源请求返回前的状态变化。
- [x] 4.3 实现 POST /api/inspection/capture 的 Origin/JSON/1 KiB 输入验证、固定错误/HTTP 映射、8 MiB PNG/12 MiB 响应/16M 像素预算和单个待发送响应限制。
- [x] 4.4 绑定 response close 的取消和发送超时，覆盖已读完 request body 后 Abort、慢客户端、超限/失败的 finally 释放；不创建图片下载 URL、list、文件缓存或 Agent 旁路。
- [x] 4.5 用慢 fake Appium 验证 Viewer capture 前的 Agent observation 仍可按原规则执行、满四条 store 不逐出、跨捕获 fail-fast、query/status/Stop 可用。

## 5. Viewer 只读检查体验

- [x] 5.1 增加独立 inspector controller 和实时/检查入口；捕获立即显示局部进度，PNG decode/结构/上下文验证成功后才整体替换，不复用 operationInFlight。
- [x] 5.2 完成 stage 内桌面两列/窄屏下排、树/搜索/详情、50 条分页、父子导航、未知/敏感/源截断提示，动态文本仅用 textContent。
- [x] 5.3 实现 requestSequence、Abort、60 秒 TTL、epoch 历史态、generation 清理、state 失败、返回实时/pagehide 释放；刷新失败保留仍有效的旧结果。
- [x] 5.4 接入 en/zh-CN、键盘树导航、Esc/焦点返回及局部 aria-live；验证主题/语言/缩放不会重捕获或丢失有效 selection。
- [x] 5.5 保持 live PNG/MJPEG/WebCodecs 的渲染和回退独立，检查时仅隐藏 live 表面；进入/退出不能重连媒体、重建 session 或产生设备动作。

## 6. 几何检查与浏览器产物

- [x] 6.1 实现共享可见交集、九区域、contain 正反变换与候选排序；覆盖非零 origin、letterbox、横竖屏、边界半开区间和比例不符关闭 overlay。
- [x] 6.2 实现冻结 PNG 上的 SVG/CSS 高亮、重叠候选切换、直接 parent 虚线与有符号几何距离；不标注为 padding/margin，不承诺原生 hit-test。
- [x] 6.3 接入真实 content box/ResizeObserver/内部滚动与 50%–200% zoom，覆盖 DPR1/2，断言 overlay 误差≤1 CSS px；本地检查交互新增设备 API 请求为零。
- [x] 6.4 将纯查询/几何模块构建为 lib/viewer/inspection-query.js，通过固定路由暴露；配置单次清理、Node/browser 输出和 dev 前置生成，验证没有 Node/DSH/MCP 依赖进入 browser bundle。

## 7. 完整验证与证据

- [x] 7.1 完成 query/store/core/HTTP 的确定性 Vitest 集合，包括64 KiB跨页、secure不回显、取消、并发与隔离，并记录500节点100次warm query的p95及输出字节，目标<20ms但不使用脆弱逐用例计时断言。
- [x] 7.2 完成 Playwright 的 Mock、fake Android/iOS 捕获与三 renderer 检查场景，包含800ms慢捕获期间安全控件可用、跨session迟到响应、TTL清理和刷新失败保留。
- [x] 7.3 完成宽/390px窄屏、横屏、zoom/DPR、键盘/焦点、双语、XSS、媒体中断回退与返回实时无残留overlay场景。
- [x] 7.4 保留并人工检查 mobile-mirror-inspector-final.png、mobile-mirror-inspector-narrow.png、mobile-mirror-inspector-zoom.png，以及实际执行失败/重试/恢复时的 refresh-failed/recovered 命名截图。
- [x] 7.5 运行 pnpm check、pnpm test:e2e、pnpm build、pnpm pack:check、public/package contract、git diff --check 与本 change 的 OpenSpec strict validation；失败分层记录，不用文件存在代替通过。
- [x] 7.6 从同一次 tarball 临时安装验证固定 browser asset、十工具 MCP 子进程及 DSH 0.1.2-rc.1 Native/PTC 的 summary→find/get/subtree→原严格动作→再观察→stop；证明 query image/attachment 增量为零。
- [x] 7.7 使用授权的非敏感 Android 页面验证检查图/树/overlay、重新获取、取消与 owned stop；保留脱敏最终截图及版本信息，缺设备时保持未完成。
- [x] 7.8 使用授权的非敏感 iOS 页面执行同等验收，独立记录 WDA/OS 版本和截图；不以 fake Appium/Android/已有媒体证据代替。

## 8. 文档、规格同步与交付

- [x] 8.1 随实现补充 ADR-0007 的 Agent/Viewer 数据与身份边界，更新 ADR-0002 相关本机 transport 说明；只在实现和评审完成后标 Accepted。
- [x] 8.2 更新当前 README/technical guide/MCP指南与 validation：十工具、summary推荐路径、旧观察可读不可操作、本机Inspector不是分享授权、无障碍与原子性限制；历史报告保持原版本事实。
- [x] 8.3 在临时副本按 semantic-actions 前驱再本 change 的顺序演练主规格合并，确认要求重命名、安装场景计数和所有旧场景不丢失；根据实际前驱标题调整本 delta，不逆序覆盖。
- [x] 8.4 记录最终已实现、工程门禁、运行时截图、打包宿主与Android/iOS物理证据的独立状态；未执行的真实模型验收不宣称通过，未获发布指令不创建tag/Release。

2026-09-15：源码与本地门禁完成；7.6 干净安装被既有 AppClaw 下游依赖阻塞，7.7 Android 连接后在显示与亮度页真机复验通过，7.8 iPhone 首次锁定/WDA 启动超时，用户解锁后真机复验通过（图/树/overlay、重新获取、取消、返回实时与 owned stop）。仅 7.6 保留未完成，见 [验收记录](../../../../docs/inspector-validation.md)。

2026-09-16：修复发布依赖/worker 与 DSH 联合输出 schema，7.6 同 tarball 干净安装 MCP/Viewer/YAML/DSH rc.1 Native/PTC 通过，tasks 39/39。见 [打包验收](../../../../docs/packaged-runtime-validation.md)。
