## 1. 实现
- [x] 1.1 真机确认文字入口、输入框、发送与回复状态，记录定位标识。
- [x] 1.2 添加受限 YAML type 的 replace/append/clear，保留原生 parser/executor。
- [x] 1.3 facade 重新定位及焦点/敏感/唯一性检查，失败终结 worker 无独立回退。
## 2. 验证
- [x] 2.1 测试参数、模式、歧义、敏感、焦点错位、provider失败与原生 worker 路径。
- [x] 2.2 Android 第三方 App文字正例、故意失败反例；若支持历史补再进入验证，保留截图与哈希。
- [x] 2.3 运行 check、test:e2e、build、pack:check 和 strict validation。
- [x] 2.4 更新文档、TODO 和真实验收边界。

## 3. iOS 同边界输入修复
- [x] 3.1 按选中输入节点身份/类型及几何匹配，容器同边界不误拒绝；保留真实歧义、敏感、焦点和可见性校验并补回归。
- [ ] 3.2 复跑 iPhone 第三方 App文字正反例，保留截图、源树和历史哈希；记录未通过边界。
- [x] 3.3 通过工程门禁，补充 iOS 修复与真机结果。

2026-09-16 再验：当前 iPhone 第三方 App包前 9 步通过，第 10 步消息正文断言失败；PNG 可见正文，但 XML 气泡仍无正文/子节点。22 份证据哈希验证通过。Codex + MCP 的图片核对和历史返回独立记录，不关闭 3.2。详见 `docs/ios-business-and-codex-vision-validation-2026-09-16.md`。
