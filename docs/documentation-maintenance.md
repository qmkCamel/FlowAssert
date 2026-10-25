# 文档维护与验证

文档分为项目入口、当前指南和历史证据。入口只回答项目是什么、如何开始以及去哪里查；当前指南描述实际操作和限制；带日期的验证报告保留当时的设备、提交、版本和结果。

## 事实归属

| 内容 | 维护位置 | 更新方式 |
| --- | --- | --- |
| 产品定位和五分钟体验 | 根目录中英文 README | 两种语言同步，避免复制任务计数 |
| 阅读导航 | docs/README.md | 按任务链接，不复制能力结论 |
| 当前能力与限制 | capabilities.md | 先核对实现、规格和证据，再更新描述 |
| 优先级和活动任务快照 | PRODUCT_TODO.md | 与每个活动 change 的 tasks.md 对账 |
| 产品行为和架构选择 | openspec/specs、活动 changes、docs/decisions | 行为或边界变化更新对应规格和 ADR |
| 历史验收和发布事件 | 带日期报告、milestones.md | 保留原结论；新证据另记日期与基线 |
| 工作台操作与维护 | test-workbench.md / workbench-maintenance.md | 操作、结果解释保留在使用指南；存储预算、回滚、探针和测量参数保留在维护参考 |
| 对外技术介绍与 FAQ | communications/technical-introduction.zh-CN.md / faq.md | 修改源稿，用 docs:render 同步 HTML；技术介绍同时更新素材清单 |

当前指南的“最后核对日期”只说明文档核对时间，不代表重新执行了真机或独立用户验收。截图标注实际采集日期、Mock/真机属性和场景；效果示意图不能作为运行证据。方案比较保留调研日期和官方出处，上游支持范围发生变化时重新查证。

## 精简约定

- 同一规则只保留一处完整说明；其他入口保留必要的使用限制并链接该处，不复制任务计数或整段参数。
- 中英文入口、技术指南和生成的 HTML 是有意保留的不同阅读入口，不按重复文件删除；翻译保持语义一致，生成文件由脚本更新。
- 提取章节时保留原标题与转向链接，避免破坏已有深链；历史报告、OpenSpec proposal/design/spec/tasks 和 ADR 分别承载证据或决策，不因主题相近合并删除。
- `mobile_mirror_*` 工具名、`MOBILE_MIRROR_*` 环境变量及 `mobile-mirror` 配置/数据路径是兼容接口，不能随产品改名批量替换。

## 本地检查

```bash
pnpm docs:check
pnpm public:check
pnpm pack:check
```

`docs:check` 检查根目录和 docs 下的 Markdown 文件/章节链接、FlowAssert main 文档链接对应的本地目标、TODO 活动任务完整性及计数，以及技术介绍的源稿、HTML 和图片哈希是否同步。FAQ HTML 由 `docs:render` 同步，目前不在 `docs:check` 的生成一致性检查范围内。代码块中的示例链接不算导航链接。它不访问外部网站，也不证明远端权限、Release 资产或真机能力。

`public:check` 负责公开文件、秘密/路径和声明的 Git 历史边界检查。`pack:check` 重新构建并读取 pnpm 实际 dry-run 清单，检查所有随包 Markdown 的相对链接及 Markdown 章节；清单格式不能识别时直接失败。它不等于隔离安装或运行时验收。

完整提交门禁仍按项目 AGENTS 和技术指南执行；`pnpm check` 已包含文档检查。

## 技术介绍的生成

```bash
pnpm docs:render
node scripts/render-technical-introduction.mjs --check
```

HTML 和素材 JSON 是生成文件，由生成器更新。默认保留清单内已记录的源码 revision，避免无关提交导致历史引用漂移。需要更新引用基线时，先核对源稿中的日期与能力，再执行 `node scripts/render-technical-introduction.mjs --refresh-revision`；该命令不会重新采集截图或执行真机验证。修改排版后检查桌面、窄屏和离线打开，保留截图。

## 源码文档与安装包

源码试用是当前内测入口，安装包只携带 package.json 明确选择的指南以及 pnpm 自动携带的 README。未随包分发的专题、原始设计、截图和验证材料使用 GitHub 链接，需要网络与仓库权限；不要为修复导航而将整个 artifacts 或私人材料目录加入包。

随包页面新增相对链接时，应同时确认目标确实随包分发。当前指南的在线入口跟随 main；需要复现历史结论时，以报告中明确的源码 SHA 和证据基线为准。历史报告可以修正导航，但不能把旧测试结果改成新一轮通过。
