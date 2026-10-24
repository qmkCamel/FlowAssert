import { describe, expect, it } from 'vitest'
import { trustedPageContainer, trustedPageScopeSchema, withinTrustedPage } from '../src/workbench-page-scope.js'
import { normalizeScreenSource } from '../src/screen-source-normalizer.js'

function fixture(platform: 'ios' | 'android') {
  const xml = platform === 'ios'
    ? '<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" visible="true" x="0" y="0" width="400" height="800"><XCUIElementTypeOther type="XCUIElementTypeOther" name="page" visible="true" x="0" y="0" width="400" height="500"><XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="page-title" label="Approved page" visible="true" x="10" y="10" width="100" height="20"/><XCUIElementTypeButton type="XCUIElementTypeButton" name="target" label="Search" visible="true" enabled="true" x="10" y="60" width="100" height="40"/></XCUIElementTypeOther></XCUIElementTypeApplication></AppiumAUT>'
    : '<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][400,800]" displayed="true"><node class="android.widget.LinearLayout" resource-id="page" bounds="[0,0][400,500]" displayed="true"><node class="android.widget.TextView" resource-id="page-title" text="Approved page" bounds="[10,10][110,30]" displayed="true"/><node class="android.widget.Button" resource-id="target" text="Search" bounds="[10,60][110,100]" displayed="true" enabled="true"/></node></node></hierarchy>'
  const tree = normalizeScreenSource(xml, platform)
  const scope = trustedPageScopeSchema.parse({ version: 2, anchor: { role: 'text', identifier: 'page-title', text: 'Approved page' },
    container: { ancestorLevels: 1, platformRole: platform === 'ios' ? 'XCUIElementTypeOther' : 'android.widget.LinearLayout', identifier: 'page' } })
  const target = tree.nodes.find(n => n.identifier === 'target')!
  return { tree, scope, target }
}
describe('trusted page scope v2', () => {
  it.each(['ios', 'android'] as const)('accepts a unique title and its registered %s container', platform => {
    const { tree, scope, target } = fixture(platform)
    expect(trustedPageContainer(tree, scope)?.identifier).toBe('page')
    expect(withinTrustedPage(tree, scope, target)).toBe(true)
  })
  it.each(['wrong-title', 'duplicate', 'hidden-duplicate', 'hidden', 'truncated', 'duplicate-id', 'cross-container', 'cycle', 'ancestor-cycle', 'application-root', 'out-of-container'])('fails closed for %s', mode => {
    const { tree, scope, target } = fixture('ios'), title = tree.nodes.find(n => n.identifier === 'page-title')!
    if (mode === 'wrong-title') title.text = 'Unapproved page'
    if (mode.includes('duplicate')) tree.nodes.push({ ...title, nodeId: mode === 'duplicate-id' ? title.nodeId : 'duplicate', visible: mode !== 'hidden-duplicate' })
    if (mode === 'hidden') title.visible = false
    if (mode === 'truncated') tree.truncated = true
    if (mode === 'cross-container') target.parentId = tree.nodes[0]!.nodeId
    if (mode === 'cycle') title.parentId = title.nodeId
    if (mode === 'ancestor-cycle') tree.nodes[0]!.parentId = tree.nodes.find(n => n.identifier === 'page')!.nodeId
    if (mode === 'out-of-container') target.bounds!.x = 500
    if (mode === 'application-root') {
      const container = tree.nodes.find(n => n.identifier === 'page')!
      container.role = 'application'; container.platformRole = 'XCUIElementTypeApplication'
    }
    expect(withinTrustedPage(tree, scope, target)).toBe(false)
  })
  it('reads old App-root registrations without granting page authority', () => {
    const { tree, target } = fixture('ios')
    expect(withinTrustedPage(tree, trustedPageScopeSchema.parse({ role: 'application', name: 'App' }), target)).toBe(false)
  })
  it('does not let the navigation target authorize itself as a page anchor', () => {
    const { tree, target } = fixture('ios')
    const scope = trustedPageScopeSchema.parse({ version: 2, anchor: { role: 'button', identifier: 'target', text: 'Search' },
      container: { ancestorLevels: 1, platformRole: 'XCUIElementTypeOther', identifier: 'page' } })
    expect(withinTrustedPage(tree, scope, target)).toBe(false)
  })
})
