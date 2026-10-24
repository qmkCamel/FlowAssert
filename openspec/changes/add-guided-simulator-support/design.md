# 设计

检查请求增加 `deviceKind: physical | simulator`，默认 physical。设备类型绑定到服务端一次性 context 的 DeviceSecret，connect 仍只接收 opaque deviceRef，客户端不能换绑类型或设备。原 TTL、取消、重放及 Appium 指纹校验保持有效。

Android 分别收集 USB 和 `emulator-数字` 在线行，TCP/offline/unauthorized 不进入模拟器候选。iOS 使用 `xcrun simctl list devices booted --json`，仅接受 iOS runtime、严格 UUID、Booted、isAvailable=true 的行，最多八台。失败/超时/无设备保持 blocked。

iOS 模拟器跳过物理设备签名诊断。能力中的 `mobileMirror:deviceKind` 仅是本机路由信息，由 provider 消费并移除，用于避免注入持久化真机签名默认值；不发送给 Appium，不作为可信真机或修复等级证明。显式禁用自动设备注册。保存本机设置时不保存模拟器 UDID 或签名。

Viewer 类型切换使已有报告 stale，丢弃迟到检查，连接期间禁用类型切换。模拟器隐藏 iOS 签名/手机信任提示，Android 保留 helper APK 确认。沿用局部进度、原结果和其他控件交互。
