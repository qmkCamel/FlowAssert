import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect, vi } from 'vitest'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import type { TestRun } from '../src/workbench-domain.js'
it('serves bounded versioned metadata without opening registered artifacts and preserves the old run API', async () => {
  const root = await mkdtemp(join(tmpdir(),'report-http-')), viewer = new ViewerServer(resolveMirrorConfig({viewerPort:0,mockStartupDelayMs:0}),{workbenchRoot:root})
  try {
    await viewer.listen(); await viewer.workbench.store.init()
    const at='2026-10-06T00:00:00.000Z'
    const run:TestRun={schemaVersion:1,id:'00000000-0000-4000-8000-000000000001',name:'Metadata',yaml:'',engine:'fixture',phase:'finished',verdict:'pass',startedAt:at,endedAt:at,sessionId:'fixture',deviceName:'Fixture',platform:'ios',provider:'mock',verificationScope:'declared-ui-assertions',businessVerification:'not-performed',visualVerification:'not-performed',cleanup:'session-retained',steps:[],evidence:[{name:'missing.png',bytes:20,sha256:'a'.repeat(64),contentType:'image/png'}]}
    await viewer.workbench.store.save(run)
    const reads = vi.spyOn(viewer.workbench.store,'readEvidence'), list=vi.spyOn(viewer.workbench.store,'listReportSummaries')
    const result=await fetch(`${viewer.url}/api/workbench/reports?source=mock`); expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({contractVersion:1,total:1,items:[{recordedVerdict:'pass',evidenceAvailability:'not-checked'}]});expect(reads).not.toHaveBeenCalled();expect(list).toHaveBeenCalledWith(10000)
    const manifests = vi.spyOn(viewer.workbench.store,'get'); manifests.mockClear()
    await expect(viewer.workbench.store.listReportSummaries(0)).rejects.toThrow(/budget/); expect(manifests).not.toHaveBeenCalled()
    const oversized = JSON.stringify({...run, yaml: 'x'.repeat(8 * 1024 * 1024)})
    await writeFile(join(root, run.id, 'manifest.json'), oversized)
    const bounded = await fetch(`${viewer.url}/api/workbench/reports`)
    expect(await bounded.json()).toMatchObject({coverage:{unreadable:1,complete:false},items:[{unreadable:true,status:'interrupted'}]})
    await writeFile(join(root, run.id, 'manifest.json'), JSON.stringify(run))
    for(const query of ['unexpected=1','result=pass&result=fail','caseId=not-a-uuid'])expect((await fetch(`${viewer.url}/api/workbench/reports?${query}`)).status).toBe(400)
    expect((await fetch(`${viewer.url}/api/runs`)).status).toBe(200);expect(reads).not.toHaveBeenCalled()
    expect((await fetch(`${viewer.url}/api/workbench/share/jobs`,{method:'POST',headers:{origin:viewer.url,'content-type':'application/json'},body:JSON.stringify({kind:'share-preview',format:'html',requestId:'no-version',runId:run.id,files:[]})})).status).toBe(400)
  } finally {await viewer.close();await rm(root,{recursive:true,force:true})}
})
