# FlowAssert 开源发布准备清单

2026-10-24：选择新名字 **FlowAssert**，采用经审查源码快照创建独立新仓库的路径。旧仓库保持私有，不导入旧 Git 对象、分支、标签、Release、Actions 日志、Issue/PR 附件或本机忽略文件。当前是本地候选，尚未公开发布。

## 已确定的发布策略

- 名称、package 与 CLI 分别为 FlowAssert、`flowassert`、`flowassert` / `flowassert-mcp` / `flowassert-viewer`。
- 新仓库计划为 `qmkCamel/flowassert`，先私有验收；默认分支 `main`。源码保留 MIT 与原贡献者版权、第三方 NOTICE。
- 首个提交没有 parent；作者和提交者使用维护者 GitHub noreply。不得导入旧 remote、标签、reflog 或原提交映射。
- package 保持 `private: true`，不发布公共 npm。未来唯一预构建安装包渠道为新 GitHub Release；旧二进制包不直接复制。
- 原配置文件名、数据目录、MCP tool 名称和序列化 schema 暂时保留兼容；产品品牌和命令入口改名不迁移或清空用户数据。
- DeepSeek Harness 仍是可选适配器，测试基线固定 `0.2.0-rc.2`；不修改其 agent loop。

## 本轮检查与边界

完整基线、检查结果和剩余阻塞见[开源审计](open-source-audit-2026-10-24.md)。历史脱敏说明只描述旧仓库在当时的操作，不是新仓库公开授权。

`public:check` 检查当前可提交文件、HEAD/远端/标签可达历史的已知秘密形状、本机路径、组织内容、作者/提交者/标签 noreply、已知私有图片指纹、公开文档与链接。它不能证明 GitHub 缓存、Release、附件或图片中所有像素都安全；也不扫描所有本地备用分支、reflog 或不可达对象。

新仓库使用首个 root commit，从结构上避免带入原历史。原库缓存仍需独立处理。截图保留原采集日期与 Mock/真机性质；旧截图中的 Mobile Mirror 是历史产品名，不表示重新执行。

## 本地可重复门禁

```bash
pnpm install --frozen-lockfile
pnpm public:check
pnpm audit --prod --audit-level=high
pnpm check
pnpm test:e2e
pnpm build
pnpm pack:check
git diff --check
```

增加独立 Gitleaks 扫描时要同时检查 Git 历史和实际导出/打包内容，启用编码与归档递归；发现项只记录位置和类型，避免输出候选秘密。虚构测试值的排除必须限定规则、文件和精确值。

## 发布前未完成事项

- [ ] 处理生产依赖审计的 critical/high，或逐项记录影响分析和明确的处置决定；不能只凭功能测试放行。
- [ ] 将本地候选迁入全新的私有 `qmkCamel/flowassert`，核对单 root commit、noreply、无旧 refs/对象与远端 SHA。
- [x] 在本地候选生成实际安装包并独立扫描解包内容，0 项秘密命中；没有复用旧 Release。
- [ ] 在新远端执行 CI、干净克隆安装；发布时重新构建、扫描与验收。
- [ ] 审查新仓库 description、topics、主页、social preview 与 README 截图；独立核实隐私和访问状态。
- [ ] 配置默认分支规则、tag 保护、secret scanning/push protection、Dependabot、漏洞私密报告等当前权限支持的安全设置。
- [ ] 逐项确认历史截图的公开必要性；仍需保留的图片做原尺寸人工审查，不能将 OCR 未命中等同于完全没有隐私。
- [ ] 原仓库保持私有；旧敏感对象/平台缓存单独联系 GitHub 处理，不通过新仓库发布暴露原引用。
- [ ] 明确执行公开发布，并复查匿名访问、社区文件、Release 资产与安装入口。

## 官方依据

[GitHub 敏感数据清理](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)说明改写历史不能删除他人克隆、fork 或全部缓存。[更改可见性](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)说明公开仓库也会公开 Actions 历史和日志。独立新仓库减少历史继承面，但不能撤回已存在的副本。
