# 本机历史材料演示

离线演示可在基础 Mock 与本机历史记录之间切换。历史页按登记步骤显示原始 PNG、实际结果、已有 XML 和日志字段；缺图或缺 XML 明确提示。慢加载期间可以返回基础 Demo，迟到结果不会抢回页面。

本轮不提供任何组织业务用例、真实截图或运行目录。折叠区提供仓库的通用 Mock 正反例 YAML；这些例子不是用户导入记录的原始用例。实际 YAML 以导入记录为准。回放不连接手机、不发送消息、不重跑原流程、不生成新通过结论。

## 显式导出本机材料

```sh
python3 scripts/export-promo-case.py --success PATH_TO_POSITIVE_RUN --failure PATH_TO_NEGATIVE_RUN
# 分步采集需要原始 collection JSON 及其相邻 runs/<id>/manifest.json：
python3 scripts/export-promo-case.py --collection PATH_TO_COLLECTION_JSON --failure PATH_TO_NEGATIVE_RUN
```

导出器只在显式调用时读取指定路径，核对 manifest、文件名、字节数和 SHA-256，并保留图片原始字节；步骤说明取自原始记录，不再内置业务标签。分步 collection 标记为 not-evaluated，不冒充一次完整回归。Appium 来源不证明是真机，模拟器记录也必须按实际来源说明。

默认输出到 Git 忽略的 `docs/communications/local-case-assets/`，可通过 `--output` 指定本地目录。输出仍包含原始材料，**不会自动脱敏，也不会上传**。不得把包含个人数据的目录加入源码或分发包；需要交接时使用工作台的审查与分享流程。

本页能力通过合成 PNG/manifest 的浏览器用例验证，验收状态见[回迁记录](../../openspec/changes/port-report-playback-and-web-selftest/implementation-validation.md)。
