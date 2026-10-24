import { mkdtemp, rm, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { it, expect } from 'vitest'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchCaseLibrary } from '../src/workbench-cases.js'
import { webCaseSchema, type WebTestRun } from '../src/workbench-web-contracts.js'
import { assertWebIsolation } from '../src/workbench-web-runtime.js'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
const content = { name:'Web',tags:[],platform:'web',executionKind:'web',target:'synthetic-viewer',scenarioVersion:1,scenarios:['VA-01'] }
it('stores immutable typed Web revisions without fake mobile fields', async()=>{
  const root=await mkdtemp(join(tmpdir(),'web-case-')),store=new WorkbenchStore(root),cases=new WorkbenchCaseLibrary(store,async()=>'a'.repeat(64))
  try{const result=await cases.save(null,{requestId:randomUUID(),expectedRevision:null,content,publicData:true});const revision=await cases.revision(result.caseId,result.revisionId)
    expect(revision.platform).toBe('web');expect(revision).not.toHaveProperty('appId');expect(revision).not.toHaveProperty('yaml')
    expect(webCaseSchema.safeParse({...content,scenarios:['VA-09']}).success).toBe(false)
    expect(webCaseSchema.safeParse({...content,url:'http://localhost:3210'}).success).toBe(false)
  }finally{await cases.close();await store.close();await rm(root,{recursive:true,force:true})}
})
it('recovers interrupted Web runs without native fallback or automatic replay',async()=>{
  const root=await mkdtemp(join(tmpdir(),'web-recover-'));let store=new WorkbenchStore(root)
  try{await store.init();const run:WebTestRun={schemaVersion:1,executionKind:'web',id:randomUUID(),requestId:randomUUID(),name:'Web',platform:'web',engine:'agent-browser',source:'viewer',phase:'running',startedAt:new Date().toISOString(),steps:[],evidence:[],input:webCaseSchema.parse(content),authoringOrigin:{caseId:randomUUID(),revisionId:randomUUID(),inputDigest:'a'.repeat(64)},visualReview:{status:'needs-review'},independentCheck:'pending',baseline:'not-compared',cleanup:'pending',resources:{owner:store.ownerGeneration,aPid:process.pid,aRoot:root,sessions:[]}}
    await store.saveRecord(run);await expect(store.get(run.id)).rejects.toThrow('not applicable');expect(await store.list()).toEqual([])
    await store.close();store=new WorkbenchStore(root);await store.init();const record=await store.getRecord(run.id)
    expect(record).toMatchObject({phase:'finished',verdict:'inconclusive',cleanup:'pending',executionKind:'web'});expect(record).not.toHaveProperty('sessionId')
    expect((await store.listReportSummaries())[0]).toMatchObject({platform:'web',deviceName:null,status:'interrupted'})
  }finally{await store.close();await rm(root,{recursive:true,force:true})}
})
it('rejects nested, alias roots and same origins',async()=>{
  const root=await mkdtemp(join(tmpdir(),'web-isolate-'))
  try{await mkdir(join(root,'a'));await mkdir(join(root,'b'));await symlink(join(root,'a'),join(root,'alias'))
    await expect(assertWebIsolation(join(root,'a'),join(root,'alias'))).rejects.toThrow('overlap')
    await expect(assertWebIsolation(root,join(root,'a'))).rejects.toThrow('overlap')
    await expect(assertWebIsolation(join(root,'a'),join(root,'b'),'http://127.0.0.1:1','http://127.0.0.1:1')).rejects.toThrow('overlap')
    await expect(assertWebIsolation(join(root,'a'),join(root,'b'),'http://127.0.0.1:1','http://127.0.0.1:2')).resolves.toBeUndefined()
  }finally{await rm(root,{recursive:true,force:true})}
})
it('is off by default and never dispatches browser commands',async()=>{
  const root=await mkdtemp(join(tmpdir(),'web-disabled-')),viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:root,webTests:false})
  try{await viewer.listen();await expect(viewer.workbench.startWeb(content,{caseId:randomUUID(),revisionId:randomUUID(),inputDigest:'a'.repeat(64)},randomUUID(),viewer.url)).rejects.toThrow('disabled');expect(viewer.workbench.activeId).toBeNull()}
  finally{await viewer.close();await rm(root,{recursive:true,force:true})}
})
