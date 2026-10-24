import { afterEach, describe, expect, it } from 'vitest'
import { Config, type Config as MirrorConfig } from '../src/config.js'
import { MirrorService } from '../src/mirror-service.js'
import {
  actionInput,
  appManagementInput,
  inspectInput,
  MobileMirrorCommandError,
  MobileMirrorCommands,
  startInput,
} from '../src/mobile-mirror-commands.js'
import { MOBILE_MIRROR_TOOL_CONTRACTS, MOBILE_MIRROR_TOOL_NAMES, dshParameters } from '../src/tool-contracts.js'

const services: MirrorService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
})

function config(overrides: Partial<MirrorConfig> = {}): MirrorConfig {
  return Config({ viewerPort: 0, mockStartupDelayMs: 0, ...overrides } as MirrorConfig)
}

describe('mobile mirror command contracts', () => {
  it('defines ten host-neutral contracts with one canonical action source and conservative annotations', () => {
    expect(MOBILE_MIRROR_TOOL_CONTRACTS.map((contract) => contract.name)).toEqual(MOBILE_MIRROR_TOOL_NAMES)
    expect(MOBILE_MIRROR_TOOL_CONTRACTS.find((contract) => contract.name === 'mobile_mirror_status')?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    })
    expect(MOBILE_MIRROR_TOOL_CONTRACTS.find((contract) => contract.name === 'mobile_mirror_action')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    })
    const dshAction = dshParameters(MOBILE_MIRROR_TOOL_CONTRACTS.find((contract) => contract.name === 'mobile_mirror_action')!.inputSchema)
    expect(dshAction.kind).toMatchObject({ required: true, enum: ['tap', 'swipe', 'back', 'tap_node', 'input_text'] })
    expect(dshAction).toHaveProperty('nodeId')
    expect(dshAction).toHaveProperty('text')
    expect(MOBILE_MIRROR_TOOL_CONTRACTS.find((contract) => contract.name === 'mobile_mirror_action')?.inputSchema.oneOf).toHaveLength(5)
    expect(MOBILE_MIRROR_TOOL_CONTRACTS.find((contract) => contract.name === 'mobile_mirror_manage_app')?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
  })

  it('parses shared start, inspect, and action inputs strictly', () => {
    expect(startInput({ provider: 'appium', capabilitiesJson: '{"platformName":"Android"}' }, 'mock')).toEqual({
      provider: 'appium',
      capabilities: { platformName: 'Android' },
    })
    expect(inspectInput({ includeImage: true })).toEqual({ image: true, structure: true })
    expect(actionInput({ kind: 'swipe', startX: 1, startY: 2, endX: 3, endY: 4 })).toEqual({
      kind: 'swipe', startX: 1, startY: 2, endX: 3, endY: 4, durationMs: 400,
    })
    expect(actionInput({ kind: 'tap_node', observationId: 'fresh', nodeId: 'n3' })).toEqual({
      kind: 'tap_node', observationId: 'fresh', nodeId: 'n3',
    })
    expect(actionInput({ kind: 'input_text', observationId: 'fresh', nodeId: 'n3', mode: 'replace', text: '' })).toEqual({
      kind: 'input_text', observationId: 'fresh', nodeId: 'n3', mode: 'replace', text: '',
    })
    expect(appManagementInput({ operation: 'activate', appId: 'com.example.App_1' })).toEqual({
      operation: 'activate', appId: 'com.example.App_1',
    })
    for (const invalid of [
      () => startInput({ capabilitiesJson: '[]' }, 'appium'),
      () => startInput({ provider: 'other' }, 'mock'),
      () => inspectInput({ includeImage: 'yes' }),
      () => actionInput({ kind: 'tap', x: Number.NaN, y: 2 }),
      () => actionInput({ kind: 'back', coordinateSpace: 'pixels' }),
      () => actionInput({ kind: 'back', secret: true }),
      () => actionInput({ kind: 'tap_node', observationId: 'fresh', nodeId: 'n3', x: 1 }),
      () => actionInput({ kind: 'input_text', observationId: 'fresh', nodeId: 'n3', mode: 'append', text: '' }),
      () => actionInput({ kind: 'input_text', observationId: 'fresh', nodeId: 'n3', mode: 'append', text: 'line\n' }),
      () => actionInput({ kind: 'input_text', observationId: 'fresh', nodeId: 'n3', mode: 'append', text: '界'.repeat(513) }),
      () => appManagementInput({ operation: 'activate', appId: '../private' }),
      () => appManagementInput({ operation: 'restart' }),
    ]) {
      expect(invalid).toThrow(MobileMirrorCommandError)
    }
  })

  it('executes the complete Mock lifecycle through one command service', async () => {
    const mirrorConfig = config()
    const service = new MirrorService(mirrorConfig, 'http://127.0.0.1:0')
    services.push(service)
    const commands = new MobileMirrorCommands(mirrorConfig, {
      service,
      iosWdaPreflight: { run: async () => ({ status: 'disabled' }) as never },
    })

    expect((await commands.execute('mobile_mirror_list_devices', {}, undefined)).kind).toBe('data')
    await commands.execute('mobile_mirror_start', { provider: 'mock' })
    const snapshot = await commands.execute('mobile_mirror_snapshot', {})
    expect(snapshot.kind).toBe('observation')
    const observationId = snapshot.kind === 'observation' ? snapshot.value.observationId : ''
    await commands.execute('mobile_mirror_action', { kind: 'tap', x: 100, y: 200, observationId })
    const inspected = await commands.execute('mobile_mirror_inspect_screen', { includeImage: false })
    expect(inspected.kind === 'observation' && inspected.value.structure?.nodes.length).toBeGreaterThan(0)
    expect((await commands.execute('mobile_mirror_stop', {})).kind).toBe('data')
  })
})
