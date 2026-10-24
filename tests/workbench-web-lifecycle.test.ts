import { it,expect,vi } from 'vitest'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import type { WebTestRun } from '../src/workbench-web-contracts.js'
const executor=vi.hoisted(()=>vi.fn())
vi.mock('../src/workbench-web-runtime.js',()=>({executeWebRun:executor}))
const content={name:'Web lifecycle',tags:[],platform:'web',executionKind:'web',target:'synthetic-viewer',scenarioVersion:1,scenarios:['VA-01'],calibration:'none'}
it('shares admission, drains cancellation, fences late pass and deduplicates request identity',async()=>{
  const root=await mkdtemp(join(tmpdir(),'web-lifecycle-')),viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:root,webTests:true})
  let finish!:()=>void;const blocked=new Promise<void>(done=>{finish=done})
  executor.mockImplementation(async(_store,run:WebTestRun)=>{await blocked;run.verdict='pass';run.cleanup='complete'})
  try{await viewer.listen();const origin={caseId:randomUUID(),revisionId:randomUUID(),inputDigest:'a'.repeat(64)},requestId=randomUUID()
    const run=await viewer.workbench.startWeb(content,origin,requestId,viewer.url)
    expect((await viewer.workbench.startWeb(content,origin,requestId,viewer.url)).id).toBe(run.id)
    await expect(viewer.workbench.start('invalid')).rejects.toThrow('already running')
    expect(()=>viewer.workbench.reserveSuite(randomUUID())).toThrow('already running')
    await viewer.workbench.cancelRecord(run.id);expect((await viewer.workbench.record(run.id)).phase).toBe('cancelling')
    expect(viewer.workbench.activeId).toBe(run.id);finish();await viewer.workbench.wait()
    expect(await viewer.workbench.record(run.id)).toMatchObject({phase:'finished',verdict:'cancelled',cleanup:'complete'});expect(viewer.workbench.activeId).toBeNull()
  }finally{finish();await viewer.close();await rm(root,{recursive:true,force:true})}
})
it('missing optional executor is inconclusive and releases native admission',async()=>{
  const root=await mkdtemp(join(tmpdir(),'web-tool-missing-')),viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:root,webTests:true})
  executor.mockRejectedValue(new Error('agent-browser ENOENT; no automatic installation'))
  try{await viewer.listen();const run=await viewer.workbench.startWeb(content,{caseId:randomUUID(),revisionId:randomUUID(),inputDigest:'a'.repeat(64)},randomUUID(),viewer.url);await viewer.workbench.wait()
    expect(await viewer.workbench.record(run.id)).toMatchObject({verdict:'inconclusive',error:expect.stringContaining('ENOENT')});expect(viewer.workbench.activeId).toBeNull()
  }finally{await viewer.close();await rm(root,{recursive:true,force:true})}
})
