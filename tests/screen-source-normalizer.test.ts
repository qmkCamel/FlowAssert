import { describe, expect, it } from 'vitest'
import { normalizeScreenSource } from '../src/screen-source-normalizer.js'

describe('screen source normalizer', () => {
  it('maps bounded Android UiAutomator attributes', () => {
    const output = normalizeScreenSource(`<?xml version="1.0"?><hierarchy>
      <node class="android.widget.Button" resource-id="submit" text="Send" content-desc="Submit order" bounds="[10,20][110,70]" clickable="true" enabled="true" focused="false"/>
    </hierarchy>`, 'android')
    expect(output).toEqual({
      truncated: false,
      nodes: [{
        nodeId: 'n0',
        role: 'button',
        platformRole: 'android.widget.Button',
        identifier: 'submit',
        name: 'Submit order',
        text: 'Send',
        bounds: { x: 10, y: 20, width: 100, height: 50 },
        enabled: true,
        actionable: true,
        focused: false,
      }],
    })
  })

  it('maps Android AutoCompleteTextView controls as inputs', () => {
    const output = normalizeScreenSource(`<hierarchy>
      <node class="android.widget.AutoCompleteTextView" resource-id="search_src_text" text="Search settings" bounds="[80,120][1000,240]" clickable="true" enabled="true" focused="true" displayed="true"/>
    </hierarchy>`, 'android')
    expect(output.nodes[0]).toMatchObject({
      role: 'input',
      platformRole: 'android.widget.AutoCompleteTextView',
      identifier: 'search_src_text',
      visible: true,
      enabled: true,
      actionable: true,
      focused: true,
    })
  })

  it('maps iOS XCTest fields without inventing absent booleans', () => {
    const output = normalizeScreenSource(`<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Demo" x="0" y="0" width="390" height="844"><XCUIElementTypeButton type="XCUIElementTypeButton" name="Continue" label="Continue" value="ready" x="20" y="40" width="120" height="44" enabled="true"/></XCUIElementTypeApplication></AppiumAUT>`, 'ios')
    expect(output.nodes[1]).toMatchObject({
      parentId: 'n0',
      role: 'button',
      platformRole: 'XCUIElementTypeButton',
      identifier: 'Continue',
      text: 'Continue',
      value: 'ready',
      bounds: { x: 20, y: 40, width: 120, height: 44 },
      enabled: true,
    })
    expect(output.nodes[1]).not.toHaveProperty('visible')
    expect(output.nodes[1]).not.toHaveProperty('actionable')
  })

  it('redacts Android password and iOS secure input content before publication', () => {
    const longSecret = `PRIVATE_LONG_${'x'.repeat(700)}`
    const android = normalizeScreenSource(`<hierarchy>
      <node class="android.widget.EditText" password="true" text="PRIVATE_ANDROID" value="••••" bounds="[0,0][100,40]" enabled="true" focused="true"/>
      <node class="Android.Widget.PassWordEditText" text="${longSecret}" value="MASKED_LENGTH_LEAK" bounds="[0,45][100,85]"/>
      <node class="android.widget.EditText" text="public" value="visible" bounds="[0,50][100,90]"/>
    </hierarchy>`, 'android')
    expect(android.nodes[0]).toMatchObject({ role: 'input', sensitive: true, focused: true })
    expect(android.nodes[0]).not.toHaveProperty('text')
    expect(android.nodes[0]).not.toHaveProperty('value')
    expect(android.nodes[1]).toMatchObject({ sensitive: true })
    expect(android.nodes[1]).not.toHaveProperty('text')
    expect(android.nodes[1]).not.toHaveProperty('value')
    expect(android.nodes[2]).toMatchObject({ text: 'public', value: 'visible' })

    const ios = normalizeScreenSource(`<AppiumAUT>
      <XCUIElementTypeSecureTextField type="XCUIElementTypeSecureTextField" label="PRIVATE_IOS" value="••••••" x="0" y="0" width="100" height="40" focused="true"/>
      <node type="xcui-element-type-secure-text-field" label="PRIVATE_IOS_VARIANT" value="MASKED_IOS_LENGTH" x="0" y="45" width="100" height="40"/>
    </AppiumAUT>`, 'ios')
    expect(ios.nodes[0]).toMatchObject({ role: 'input', sensitive: true, focused: true })
    expect(ios.nodes[1]).toMatchObject({ role: 'input', sensitive: true })
    expect(JSON.stringify({ android, ios })).not.toMatch(/PRIVATE_|MASKED_|••|x{100}/)
  })

  it('returns an honest empty structure for a semantic-empty source', () => {
    expect(normalizeScreenSource('<hierarchy/>', 'android')).toEqual({ nodes: [], truncated: false })
  })

  it('truncates fields and node collection at fixed limits', () => {
    const longText = '界'.repeat(513)
    const fieldOutput = normalizeScreenSource(`<hierarchy><node class="android.widget.TextView" text="${longText}"/></hierarchy>`, 'android')
    expect(fieldOutput).toMatchObject({ truncated: true, truncatedReason: 'field-limit' })
    expect([...fieldOutput.nodes[0]!.text!]).toHaveLength(512)

    const nodes = Array.from({ length: 505 }, (_, index) => `<node class="android.widget.TextView" text="${index}"/>`).join('')
    const nodeOutput = normalizeScreenSource(`<hierarchy>${nodes}</hierarchy>`, 'android')
    expect(nodeOutput.nodes).toHaveLength(500)
    expect(nodeOutput).toMatchObject({ truncated: true, truncatedReason: 'node-limit' })
  })

  it('fails closed for malformed XML, entities, and oversized source without leaking source text', () => {
    for (const xml of [
      '<hierarchy><node secret="PRIVATE_UDID"></hierarchy>',
      '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///private/secret">]><hierarchy>&xxe;</hierarchy>',
    ]) {
      const error = capture(() => normalizeScreenSource(xml, 'android'))
      expect(error).toMatchObject({ code: 'screen_structure_invalid' })
      expect(error.message).not.toContain('PRIVATE_UDID')
      expect(error.message).not.toContain('/private/secret')
    }
    const oversized = `<hierarchy>${' '.repeat(4 * 1024 * 1024)}</hierarchy>`
    expect(() => normalizeScreenSource(oversized, 'android')).toThrow(expect.objectContaining({ code: 'screen_observation_too_large' }))
  })
})

function capture(work: () => unknown): Error & { code?: string } {
  try {
    work()
    throw new Error('Expected work to fail')
  } catch (error) {
    return error as Error & { code?: string }
  }
}
