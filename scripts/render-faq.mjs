// docs/faq.md is the only authored FAQ. Regenerate the browser-readable copy:
// node scripts/render-faq.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { marked } from 'marked'

const source = new URL('../docs/faq.md', import.meta.url)
const markdown = await readFile(source, 'utf8')
const body = marked.parse(markdown)
const html = `<!doctype html>
<!-- Generated from docs/faq.md by scripts/render-faq.mjs. Do not edit manually. -->
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlowAssert · 常见问题 FAQ</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101624;color:#edf2fa;font:16px/1.85 system-ui,-apple-system,"PingFang SC",sans-serif}main{max-width:900px;margin:auto;padding:32px 24px 64px;overflow-wrap:anywhere}nav{display:flex;gap:24px;flex-wrap:wrap;padding-bottom:24px;border-bottom:1px solid #344058}a{color:#b5f477;text-underline-offset:4px}a:focus-visible{outline:2px solid #b5f477;outline-offset:4px}h1{font-size:32px}h2{margin-top:40px;border-bottom:1px solid #344058;padding-bottom:12px}h3{font-size:19px;margin-top:28px}pre{overflow:auto;padding:18px;background:#192236;border-radius:8px;font-size:13px}code{font-family:ui-monospace,monospace}p,li{color:#d3ddec}table{display:block;overflow:auto;border-collapse:collapse}td,th{padding:8px;border:1px solid #344058}[id]{scroll-margin-top:24px}
</style></head><body><main><nav aria-label="FAQ 导航"><a href="communications/mobile-mirror-demo.html#mock-demo">← 返回交互演示</a><a href="#q11">首次试用</a></nav>
${body}
</main></body></html>
`
await writeFile(new URL('../docs/faq.html', import.meta.url), html)
console.log('Generated docs/faq.html from docs/faq.md')
