# 工作台视频历史验收

日期：2026-09-16。对应[归档 OpenSpec](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-workbench-video-history/tasks.md)与 [ADR 0006](decisions/0006-native-yaml-workbench.md)。

## 已实现

显式勾选录像 → 录制当前手机画面 → 派发 YAML → 自动结束 → run 归档及 SHA-256 → 历史回放/下载 → 步骤近似时间跳转。视频不含声音，复用 Viewer 输入，不新增设备操作。既有手动截图/录屏保留。

视频独立于 UI 断言结论。提前停止/隐藏/断开等标记部分；归档失败提供重试，保留本页下载；旧 run 无视频正常显示。原始手机内容仍仅本机保存。

## 验证范围

- `tests/workbench-video.test.ts`：真实 HTTP/磁盘读写，视频绑定、同源、容器/元数据校验、大小上限、互斥、关闭时终止在途上传、幂等、禁止覆盖、独立索引故障重试、哈希损坏拒读、Range/416/尾部范围、重启及旧记录兼容。此层视频仅为容器头 fixture，不声称可解码。
- `tests/e2e/workbench-video.spec.ts`：真实 Chromium Canvas/MediaRecorder 编码，下载比对、视频实际解码、无音轨、重启历史、步骤跳转、慢保存时主题/截图交互、上传失败重试、提前停止及关闭工作台面板后隐藏页面自动保存部分视频；不支持录屏时不派发已勾选录像的流程，取消勾选后正常运行。
- 保留并检查 [历史回放](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-workbench-video-history.png) 和 [窄屏](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-workbench-video-narrow.png) runtime 截图。

2026-09-16 补验：iPhone 16 Plus / iOS 26.2.1，系统设置页 7 步流程通过，流程与 Viewer 共用同一 Appium 会话。录像 42.640 秒、8,408,564 字节，VP8 886×1920，无音轨；完整解码 1,279 帧，其中 657 个不同帧哈希。SHA-256：`98ef1422f3f842cb2aef4f3105db4b24af59f72af3fadda6d1c247293d96ec3d`。

停止会话并重启 Viewer 后，历史记录恢复、视频可解码、步骤跳转至 3.60 秒；录制期间主题切换和截图可用。运行 ID `a1913b60-0502-480e-9a67-a7bda880ded0`。原始材料位于本机忽略目录 `artifacts/physical-validation/workbench-video-2026-09-16T04-13-36-822Z/`；已打开检查 restored.png，含个人设置页面，不公开入库。停止后另查 4723/8100/9100 无监听、设备进程无 WDA runner。首次 WDA Xcode 65 启动失败材料另存，后续开启诊断重试通过，不覆盖失败记录或声称已定位首次失败根因。

可复用入口：`pnpm test:video:physical`，显式提供 `MOBILE_MIRROR_CAPABILITIES_PATH`、`MOBILE_MIRROR_FLOW_PATH`、`MOBILE_MIRROR_APPIUM_EXECUTABLE` 三个绝对路径；Android 媒体另按本地安装提供 scrcpy 配置。Android 同日补验通过：设置页 7 步、11.4 秒 VP8、重启回放与步骤跳转，完整解码 342 帧；详见 [Android 报告](https://github.com/qmkCamel/flowassert/blob/main/docs/android-acceptance-2026-09-16.md)。两端均有独立 run 归档证据，不以旧手动录屏代替。

## 限制

2026-10-07 `REDACTED_REVISION` 初轮候选续验：双端预装合成 Fixture 各 7 步、同会话、完整录像归档、重启回放/近似步骤跳转通过；ffmpeg 实际解码 Android 302 帧（269 不同帧）/ iOS 158 帧（25 不同帧），均无音轨。录像尺寸 Android 864×1920、iOS 324×700；原生登记截图分别 1080×2400 / 1290×2796。iOS MJPEG 缩放不等于原生视频分辨率，未证明全帧率或零丢帧。最新探针先检查 build、先验证 Fixture、等待本次 activeId，失败诊断仅本机私有留存。首段含桌面的录像及失败尝试不公开、不重包装为已脱敏材料；已有录像不改标为后续合入 `REDACTED_REVISION` 的新执行。详见 [当前证据与未完成条件](physical-validation-2026-10-07.md)。

`REDACTED_REVISION` 加本轮改动另补 Android 同会话 7 步、完整归档与重启回放/跳转：7781 ms、1345376 bytes、VP8 864×1920、完整解码 226 帧 / 225 不同帧 / 无音轨，回放 runtime 截图已查看。其两个原生 run 的 26 份登记文件 hash/bytes 与 manifest 前后一致；独立录像索引另由视频探针读取校验，原生审计入口不冒充视频解码器。没有新 iOS 录像记录，手机 Offline 前提仍在。

录像需页面存活至上传完成；页面隐藏提前结束，强制关闭/崩溃可能丢失未上传 Blob。录屏仍限制 10 分钟/128 MiB，上传上限 136 MiB 包含末尾分片余量。步骤定位包含同机时间和媒体延迟误差，非逐帧原子同步。容器头和 hash 不是服务端解码验收，浏览器不支持该格式时明确读取失败。`complete` 表示记录覆盖到流程终态且归档完成，不保证全帧率、零遮挡或业务正确。

## 工程门禁

- `pnpm check`：类型/契约通过，41 个测试文件、302 项测试通过。
- `pnpm test:e2e`：41/41 通过，包含新增 5 个视频历史场景；最终损坏状态文案调整后回放/下载/重启/损坏场景复验 1/1。
- `pnpm build`、`pnpm pack:check`：通过；包包含视频归档代码和本文档。
- OpenSpec 1.2.0 本 change strict、公开检查与 `git diff --check` 通过。
- 当前宿主兼容基线仍为 DSH 0.1.2-rc.1；本次未新增真实模型或打包宿主端到端验收。
