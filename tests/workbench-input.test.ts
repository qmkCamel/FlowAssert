import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseWorkbenchFlow } from '../src/workbench-flow.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { MirrorService } from '../src/mirror-service.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MockProvider } from '../src/providers/mock-provider.js'
const flow = (steps: string) => `name: Public input\nplatform: ios\nappId: local.mobile-mirror.demo\n---\n${steps}\n- assertVisible: {id: public-input}\n- done\n`
describe('workbench public input', () => {
  it('requires structured input, bounded text and valid modes', async () => {
    for (const step of ['- type: hello', '- type: {text: hello}', '- type: {into: {id: public-input}, text: 123}', '- type: {into: {id: public-input}, text: a, mode: clear}', '- type: {into: {id: public-input}, text: "", mode: append}']) await expect(parseWorkbenchFlow(flow(step))).rejects.toThrow()
    const parsed = await parseWorkbenchFlow(flow('- type: {into: {id: public-input}, text: ""}'))
    expect(parsed.inputModes).toEqual({1:'replace'})
    expect(parsed.yaml).toContain('text: ""')
  })
  for (const failure of [false, true]) it(`native worker performs modes and preserves evidence (failure=${failure})`, async () => {
    const root=await mkdtemp(join(tmpdir(),'workbench-input-'))
    const provider=new MockProvider(0,{failTextAfterMutation:failure})
    const mirror=new MirrorService(resolveMirrorConfig({mockStartupDelayMs:0}),'http://127.0.0.1',{providerFactory:()=>provider})
    const wb=new WorkbenchService(mirror,{root})
    try {
      await mirror.start({provider:'mock'})
      const yaml=flow(`- type: {into: {id: public-input}, text: hello}\n- assert: {target: {id: public-input}, properties: {value: hello}}\n- type: {into: {id: public-input}, text: world, mode: append}\n- assert: {target: {id: public-input}, properties: {value: helloworld}}\n- type: {into: {id: public-input}, text: ""}\n- assertNotVisible: {id: public-input, value: helloworld}`)
      const started=await wb.start(yaml);await wb.wait();const run=await wb.get(started.id)
      expect(run.verdict,JSON.stringify(run)).toBe(failure?'inconclusive':'pass')
      expect(run.steps[0]!.evidence.length).toBe(2+(run.steps[0]!.actionEvidence?.actions.filter(action=>action.before).length??0))
      expect(run.steps[0]!.actionEvidence?.actions[0]?.kind).toBe('tap') // Input focus only; never persist typed values as action metadata.
      if(failure) expect(run.steps).toHaveLength(1)
      else { const source=await provider.screenSource();if(source.kind==='normalized')expect(source.structure.nodes.find(n=>n.identifier==='public-input')!.value).toBe('') }
    } finally {await wb.close();await mirror.dispose();await rm(root,{recursive:true,force:true})}
  },20000)
})

import { WorkbenchDevice } from '../src/workbench-device.js'
import type { MirrorProvider } from '../src/types.js'
import { vi } from 'vitest'
it.each(['sensitive', 'unfocused', 'ambiguous', 'disabled'])('rejects %s before provider input', async (reason) => {
  const node=`<node class="android.widget.EditText" resource-id="field" text="" content-desc="" enabled="${reason!=='disabled'}" displayed="true" focused="${reason!=='unfocused'}" password="${reason==='sensitive'}" bounds="[10,20][210,70]"/>`
  const inputText=vi.fn()
  const provider={screenSource:async()=>({kind:'xml',platform:'android',xml:`<hierarchy>${node}${reason==='ambiguous'?node:''}</hierarchy>`}),inputText,screenGeometry:async()=>({viewport:{x:0,y:0,width:400,height:800}})} as unknown as MirrorProvider
  const device=new WorkbenchDevice('test','android',provider,fn=>fn(new AbortController().signal),()=>{},async()=>{})
  await expect(device.callTool('appium_set_value',{text:'public',mode:'replace',selector:{id:'field'}},'test.app')).rejects.toThrow()
  expect(inputText).not.toHaveBeenCalled()
})
it.each([false, true])('materializes Android append without using accessibility labels or hints (hint=%s)', async (hint) => {
  const inputText=vi.fn()
  const provider={screenSource:async()=>({kind:'xml',platform:'android',xml:`<hierarchy><node class="android.widget.EditText" resource-id="field" text="prefix" content-desc="label" showing-hint="${hint}" enabled="true" displayed="true" focused="true" password="false" bounds="[10,20][210,70]"/></hierarchy>`}),inputText,screenGeometry:async()=>({viewport:{x:0,y:0,width:400,height:800}})} as unknown as MirrorProvider
  const device=new WorkbenchDevice('test','android',provider,fn=>fn(new AbortController().signal),()=>{},async()=>{})
  await device.callTool('appium_set_value',{text:'suffix',mode:'append',selector:{id:'field'}},'test.app')
  expect(inputText.mock.calls[0]![0]).toMatchObject({mode:'replace',text:hint?'suffix':'prefixsuffix'})
})
