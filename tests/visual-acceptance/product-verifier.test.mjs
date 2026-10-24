import { createHash } from 'node:crypto'
import { expect,it } from 'vitest'
import sharp from 'sharp'
import { verifyProductRecord } from '../../scripts/web-visual-acceptance/verify-product.mjs'

it('independently rejects a false pass, missing screenshot, changed facts and target writes', async () => {
  const bytes=new Map(), hash=value=>createHash('sha256').update(value).digest('hex')
  const file=(name,value,contentType='application/json')=>{const data=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));bytes.set(name,data);return{name,contentType,bytes:data.length,sha256:hash(data)}}
  const png=await sharp({create:{width:1280,height:800,channels:4,background:'#123456'}}).png().toBuffer()
  const facts=[{label:'initial',value:{url:'http://127.0.0.1:5555/#/runs/fixture?step=1&tab=evidence',result:{visible:true},play:{visible:true,inViewport:true,unobscured:true}}}]
  const images=['overview-viewport','overview-full'].map(name=>file(`va-01-${name}.png`,png,'image/png'))
  const run={executionKind:'web',phase:'finished',cleanup:'complete',verdict:'pass',independentCheck:'pass',resources:{bOrigin:'http://127.0.0.1:5555',targetRunId:'fixture',buildSha256:'build',aPid:1,bPid:2},input:{scenarios:['VA-01']},evidence:[file('web-requests.json',[{method:'GET'}])],steps:[{kind:'VA-01',status:'passed',execution:'completed',actions:5,checks:[{pass:true}],facts,evidence:[...images,file('va-01-facts.json',facts),file('va-01-page.json',{}),file('va-01-commands.txt',Buffer.from('unit command evidence'),'text/plain')]}],visualReview:{status:'pass',reviewer:'unit fixture',observations:'Synthetic checker test, not a visual approval.',at:new Date().toISOString(),hashes:images.map(i=>i.sha256)}}
  const read=async f=>{const data=bytes.get(f.name);if(!data)throw new Error('missing');return data}
  expect((await verifyProductRecord(run,read)).pass).toBe(true)
  const fake=structuredClone(run);fake.steps[0].facts[0].value.play.visible=false
  fake.steps[0].evidence[2]=file('va-01-facts.json',fake.steps[0].facts)
  expect(await verifyProductRecord(fake,read)).toMatchObject({pass:false,reportConsistent:false})
  bytes.set('va-01-facts.json',Buffer.from(JSON.stringify(facts)))
  expect((await verifyProductRecord(run,async f=>{if(f.name.endsWith('overview-full.png'))throw new Error('missing');return read(f)})).pass).toBe(false)
  const write=structuredClone(run);write.evidence=[file('web-requests.json',[{method:'POST'}])]
  expect((await verifyProductRecord(write,read)).problems).toContain('unexpected-target-write')
})
