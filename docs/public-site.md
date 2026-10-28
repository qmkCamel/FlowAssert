# 产品网站与浏览器 Playground

公开入口：[English](https://qmkCamel.github.io/FlowAssert/?lang=en) · [简体中文](https://qmkCamel.github.io/FlowAssert/?lang=zh) · [Playground](https://qmkCamel.github.io/FlowAssert/?lang=zh#playground) · [完整视频](https://qmkCamel.github.io/FlowAssert/?lang=zh#film)。

网站负责介绍产品、提供无需安装的模拟体验和播放产品视频。本机工作台及真机使用仍从 [README](../README.zh-CN.md#快速开始)进入。

## Playground 的范围

- 在浏览器中解析实际编辑的 YAML，支持 `launchApp`、`tap: {accessibilityId: action-card}`、`assertVisible: {text: ...}`、`assertNotVisible: {text: ...}`、末尾 `done`。断言精确匹配 `Hello, harness.` 或当前的 `N actions received`。
- 每次运行使用独立的零计数 Mock；同一流程中的 `launchApp` 不清零。支持失败停止、取消、逐步状态回看，以及最近八次运行的会话历史。
- 输入最大 12,000 字符、40 步；拒绝不支持的字段、命令、标签和别名，不解释脚本或远端引用。
- 不接入 `MirrorService`、Appium、MCP、本机端口或模型。导出的 JSON 明确携带 `flowassert-browser-mock` 与 `simulation-not-device-evidence`；模拟状态不是设备截图或真机验收证据。
- YAML 与结果只在当前页面内存中，刷新后清除。仅语言偏好保存到 localStorage；`?lang=en` / `?lang=zh` 优先。切换语言不清除编辑与历史。

## 本机开发与验证

沿用仓库固定的 Node / pnpm 工具链，在仓库根目录运行：

```bash
pnpm site:build
pnpm site:preview
pnpm site:test
```

预览地址为 `http://127.0.0.1:4173/FlowAssert/`，与项目 Pages 路径一致。预览服务只监听回环，提供 MP4 Range 响应以验证拖动播放。源码在 [site](https://github.com/qmkCamel/flowassert/tree/main/site)，构建与预览脚本在 [scripts/site](https://github.com/qmkCamel/flowassert/tree/main/scripts/site)。

构建输出 `dist/site/`，只包含显式列出的页面、脚本、样式、固定版本 YAML 浏览器模块及其许可证、选定的公开 Mock 图片和完整视频。媒体复用 [product-video](communications/product-video/README.md)，不在源码中重复复制；英文 VTT 在 `site/subtitles.en.vtt`，中文 VTT 从已有 SRT 转换。英文界面默认显示英文字幕，中文界面使用视频内嵌中文字幕；播放控件可自行选择轨道。

网站测试覆盖 YAML 解释与拒绝、失败和取消、运行时编辑与语言切换、旧结果保留、模拟来源导出、视频播放与跳转、字幕、320/390 像素布局和项目子路径。完整交付仍运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check`。

## GitHub Pages 发布

仓库 Settings → Pages 的发布来源使用 **GitHub Actions**。[网站工作流](https://github.com/qmkCamel/flowassert/blob/main/.github/workflows/website.yml) 在 main 的网站相关内容变化时构建、测试并部署，也支持手动触发；PR 仅检查。

只有部署 job 具有 `pages: write` 与 `id-token: write`，通过 `github-pages` environment 发布 `dist/site`。不需要外部托管服务或新增长期密钥。部署方式遵循 [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

更改视频后重新构建即可带入已确认成片，并检查中英文字幕同步。发布后核对 Actions 的部署结果、站点 URL、视频内容类型及实际 Playground；提交成功本身不代表部署完成。
