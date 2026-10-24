import { describe, expect, it } from 'vitest'
import { documentInfo, localTarget, packageLinkErrors, taskCounts } from '../scripts/documentation-utils.mjs'

describe('documentation checks', () => {
  it('reads real links and explicit anchors, ignoring code examples', () => {
    const info = documentInfo('# 中文 / Title\n\n# 中文 / Title\n\n<a id="q9"></a>\n\n[FAQ][faq]\n\n[faq]: faq.md#q9\n\n```md\n[example](absent.md)\n```\n')
    expect([...info.anchors]).toEqual(['中文--title', '中文--title-1', 'q9'])
    expect(info.links).toEqual(['faq.md#q9'])
  })
  it('resolves encoded fragments and rejects escaping local links', () => {
    expect(localTarget('docs/README.md', '../README.md#%E4%B8%AD%E6%96%87')).toEqual({ target: 'README.md', fragment: '中文' })
    expect(localTarget('docs/README.md', 'https://example.com/a')).toBeNull()
    expect(() => localTarget('README.md', '../outside.md')).toThrow('outside repository')
  })
  it('detects missing package assets even when they exist in the source tree', () => {
    const docs = new Map([['README.md', '[guide](docs/guide.md) ![screenshot](assets/screen.png)'], ['docs/guide.md', '# Guide']])
    expect(packageLinkErrors(['README.md', 'docs/guide.md'], docs)).toEqual(['README.md: not packaged: assets/screen.png'])
    expect(packageLinkErrors(['README.md', 'docs/guide.md', 'assets/screen.png'], docs)).toEqual([])
  })
  it('checks packaged fragments as well as files', () => {
    const docs = new Map([['README.md', '[guide](docs/guide.md#removed)'], ['docs/guide.md', '# Guide']])
    expect(packageLinkErrors([...docs.keys()], docs)).toEqual(['README.md: missing packaged anchor: docs/guide.md#removed'])
  })
  it('counts nested OpenSpec checkboxes without counting inline examples', () => {
    expect(taskCounts('- [x] done\n  - [X] nested\n- [ ] pending\ntext - [x] example')).toBe('2/3')
  })
})
