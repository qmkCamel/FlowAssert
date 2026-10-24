import { describe, it, expect, vi } from 'vitest'
import { WorkbenchDevice } from '../src/workbench-device.js'
import type { MirrorProvider } from '../src/types.js'

const bounds = 'x="27" y="524" width="343" height="26"'
const input = (attrs = '') => `<XCUIElementTypeTextView type="XCUIElementTypeTextView" name="field" enabled="true" visible="true" focused="true" ${bounds} ${attrs}/>`
function deviceFor(xml: string) {
  const inputText = vi.fn()
  const provider = { screenSource: async () => ({ kind: 'xml', platform: 'ios', xml }), inputText,
    screenGeometry: async () => ({ viewport: { x: 0, y: 0, width: 430, height: 932 } }) } as unknown as MirrorProvider
  return { device: new WorkbenchDevice('test', 'ios', provider, fn => fn(new AbortController().signal), () => {}, async () => {}), inputText }
}
const args = { text: 'public', mode: 'replace', selector: { id: 'field' } }
describe('iOS input identity with overlapping containers', () => {
  it('types into the identified TextView inside a same-bounds container', async () => {
    const { device, inputText } = deviceFor(`<App><XCUIElementTypeOther type="XCUIElementTypeOther" ${bounds}>${input()}</XCUIElementTypeOther></App>`)
    await device.callTool('appium_set_value', args, 'test.app')
    expect(inputText).toHaveBeenCalledOnce()
    expect(inputText.mock.calls[0]![0]).toMatchObject({ text: 'public', mode: 'replace', expectedBounds: {x:27,y:524,width:343,height:26} })
  })
  it('does not borrow focus from a different input with the same bounds', async () => {
    const { device, inputText } = deviceFor(`<App>${input().replace('focused="true"', 'focused="false"')}${input().replace('name="field"', 'name="other"')}</App>`)
    await expect(device.callTool('appium_set_value', args, 'test.app')).rejects.toThrow('focused')
    expect(inputText).not.toHaveBeenCalled()
  })
  it('rejects two indistinguishable inputs even when selector index chooses one', async () => {
    const { device, inputText } = deviceFor(`<App>${input()}${input()}</App>`)
    await expect(device.callTool('appium_set_value', {...args,selector:{id:'field',index:0}}, 'test.app')).rejects.toThrow('ambiguous')
    expect(inputText).not.toHaveBeenCalled()
  })
  it.each(['unfocused', 'hidden', 'disabled', 'secure'])('still rejects %s input', async reason => {
    let xml = input()
    if (reason === 'unfocused') xml = xml.replace('focused="true"','focused="false"')
    if (reason === 'hidden') xml = xml.replace('visible="true"','visible="false"')
    if (reason === 'disabled') xml = xml.replace('enabled="true"','enabled="false"')
    if (reason === 'secure') xml = xml.replaceAll('XCUIElementTypeTextView','XCUIElementTypeSecureTextField')
    const {device,inputText} = deviceFor(`<App>${xml}</App>`)
    await expect(device.callTool('appium_set_value',args,'test.app')).rejects.toThrow()
    expect(inputText).not.toHaveBeenCalled()
  })
})

import { normalizeScreenSource } from '../src/screen-source-normalizer.js'
it('maps iOS multiline editors as inputs without reclassifying Android text labels', () => {
  for (const kind of ['TextView', 'TextEditor']) expect(normalizeScreenSource(`<XCUIElementType${kind}/>`, 'ios').nodes[0]!.role).toBe('input')
  expect(normalizeScreenSource('<hierarchy><node class="android.widget.TextView"/></hierarchy>', 'android').nodes[0]!.role).toBe('text')
})

it.each(['prefix', ''])('materializes iOS append from value rather than cursor or label (%s)', async value => {
  const {device,inputText} = deviceFor(`<App>${input(`value="${value}" label="Input label"`)}</App>`)
  await device.callTool('appium_set_value',{...args,text:'suffix',mode:'append'},'test.app')
  expect(inputText.mock.calls[0]![0]).toMatchObject({mode:'replace',text:value+'suffix'})
})
