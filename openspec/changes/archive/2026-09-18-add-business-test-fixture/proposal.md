## Why
编排器已有受控 API 验证，但缺少可重复的真实手机业务验收对象。新增仓库自带的测试订单 App 和持久化服务，消除对外部业务账号及接口的依赖。

## What Changes
- Android 原生 Java 与 iOS SwiftUI 测试 App，输入测试编号后提交固定商品订单。
- 本机持久化 Test Server，独立准备、业务写入、查询、清理接口。
- 注册扩展、双平台 YAML、正例和错误金额反例、真机探针与证据说明。
- 默认 loopback；iOS 真机 LAN 访问需显式指定监听地址。仅合成数据，无生产接口、不涉及支付。

## Capabilities
### New Capabilities
- `business-test-fixture`: 可重复的手机 UI 与独立后端业务验收对象。
### Modified Capabilities
无。

## Impact
仅开发验收夹具，不加入插件运行包，不改变 MirrorService/Appium 所有权，不做历史兼容。
