# 修复安全语料 v1（合成契约层）

冻结文件：[repair-safety-corpus.test.ts](../../tests/repair-safety-corpus.test.ts)。2026-10-04 使用 `pnpm exec vitest run tests/repair-safety-corpus.test.ts` 验证，1 个测试包含 60 个命名向量。

| 类别 | 样本 | 软件级成功 | 正确弃权／未修复 | 错误验证 |
| --- | ---: | ---: | ---: | ---: |
| 定位器漂移 | 20 | 20 | 0 | 0 |
| 产品缺陷（候选复验失败） | 20 | 0 | 20 | 0 |
| 安全反例（缺证、身份错配、跳过、篡改等） | 20 | 0 | 20 | 0 |

这只是纯判定器和 AST 差异守卫的合成安全门禁。20 个正例采用不同导航定位器身份，但共享同一种受限修复形态；产品缺陷通过失败的候选复验回执建模。它不测实际模型提案质量、不证明真实 App 的 locator 可修率，也不替代真机和非作者样本。Mock 结果最高为 `software-verified`，默认 device 等级仍失败。
