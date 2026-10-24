## Context
沿用现有 prepare → Appium UI → verify → cleanup。原编排任务 4.5 需要真实手机操作产生后端状态，不能用 Mock 替代。

## Decisions
- 最小订单商品 fixture-item，数量 1，金额 1200 分；不接真实支付。
- 每轮 prepare 生成 UUID 并先登记清理 token，再调用幂等 PUT 创建 fixture，避免创建成功却丢失补偿线索。
- App 提交该 UUID，服务器按 fixture 创建订单；重复提交幂等。verify 通过独立 GET 从磁盘读取，不接收 UI 文案作为真值。
- 服务使用 SQLite 单文件事务持久化；进程重启仍可读取。删除 fixture 级联删除订单；清理再次 GET 确认 404。
- 默认 127.0.0.1。Android 使用显式 adb reverse；iOS 可用显式 LAN 监听地址，非公网服务。接口只接受 JSON，不开放 CORS；Origin 请求拒绝。
- 原生控件公开稳定 accessibility identifier；网络期间显示进度、阻止重复提交，保留上一成功结果，帮助按钮仍可用。
- 源码/构建产物/设备验收分别记录，iOS 无设备或签名时不虚报实测。

## Risks / Trade-offs
本地夹具不是生产业务覆盖证明；LAN 模式仅用于可信测试网络。安装只针对独立测试包名，不清空其他 App 数据。首期不添加旧格式兼容。
