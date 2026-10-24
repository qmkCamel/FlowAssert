import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveMirrorConfig } from '../src/mcp-config.js'

// Exercises the shipped adapter and child entry, not source imports of the runtime.
const entry = new URL('../lib/application.js', import.meta.url).href
const { LocalDeviceRuntime } = await import(entry)
const root = resolve('artifacts/visual-acceptance', `compiled-${new Date().toISOString().replaceAll(':','-')}`)
await mkdir(root,{recursive:true})
const previous = process.env.MOBILE_MIRROR_WEB_TESTS
process.env.MOBILE_MIRROR_WEB_TESTS = '1'
const runtime = new LocalDeviceRuntime(resolveMirrorConfig({viewerPort:0}), {workbenchRoot:join(root,'a-runs')})
try {
  await runtime.listen()
  const content = {name:'Compiled Web adapter probe',tags:['web-selftest'],executionKind:'web',platform:'web',target:'synthetic-viewer',scenarioVersion:1,scenarios:['VA-01'],calibration:'none'}
  const saved = await runtime.application.cases.save(null,{requestId:randomUUID(),expectedRevision:null,content,publicData:true})
  const revision = await runtime.application.cases.revision(saved.caseId,saved.revisionId)
  const run = await runtime.application.workbench.startWeb(content,{caseId:saved.caseId,revisionId:saved.revisionId,inputDigest:revision.contentDigest},randomUUID(),runtime.viewer.url)
  await runtime.application.workbench.wait()
  const result = await runtime.application.workbench.record(run.id)
  await writeFile(join(root,'probe.json'),JSON.stringify(result,null,2))
  if(result.phase!=='finished'||result.cleanup!=='complete'||result.error||result.steps.length!==1||!result.steps[0].checks.every((check:{pass:boolean})=>check.pass))throw new Error(`Compiled execution failed: ${result.error??JSON.stringify(result.steps)}`)
  if(result.verdict!=='inconclusive'||result.visualReview.status!=='needs-review')throw new Error('Compiled capture incorrectly claimed visual acceptance')
  console.log(JSON.stringify({root,id:run.id,execution:'completed',visualReview:'needs-review'},null,2))
} finally {
  await runtime.close()
  if(previous===undefined)delete process.env.MOBILE_MIRROR_WEB_TESTS;else process.env.MOBILE_MIRROR_WEB_TESTS=previous
}
