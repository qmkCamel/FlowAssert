import { parentPort, workerData } from 'node:worker_threads'
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { XMLParser } from 'fast-xml-parser'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const dimension=(status,reason,baselineRefs=[],targetRefs=[],details,completeness='complete')=>({status,completeness,reason,baselineRefs,targetRefs,...(details===undefined?{}:{details})})
const evidence=(step,kind)=>step?.evidence?.find(file=>kind==='png'?file.contentType==='image/png':file.name.endsWith('.xml'))
async function readEvidence(root,run,file){
  if(!file||!/^[a-z0-9-]+\.(png|xml|yaml|json|txt|webm|mp4)$/.test(file.name))throw new Error('Invalid evidence reference')
  const h=await open(join(root,run.id,file.name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const bytes=await h.readFile();if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw new Error(`Evidence integrity check failed: ${file.name}`);return bytes}finally{await h.close()}
}
const stepSignature=step=>step.comparison?.semanticDigest
function align(a,b,samePlan){
  const out=[],used=new Set()
  for(const left of a){let indexes=[]
    if(samePlan&&left.comparison?.stepKey){indexes=b.map((right,i)=>right.comparison?.stepKey===left.comparison.stepKey?i:-1).filter(i=>i>=0&&!used.has(i));if(indexes.length===0&&left.path)indexes=b.map((right,i)=>right.path===left.path&&right.kind===left.kind&&right.comparison?.occurrence===left.comparison?.occurrence?i:-1).filter(i=>i>=0&&!used.has(i))}
    else if(stepSignature(left))indexes=b.map((right,i)=>stepSignature(right)===stepSignature(left)&&right.comparison?.ancestry?.join('/')===left.comparison?.ancestry?.join('/')?i:-1).filter(i=>i>=0&&!used.has(i))
    if(indexes.length===1){used.add(indexes[0]);out.push({baseline:left,target:b[indexes[0]],relation:'matched'})}
    else out.push({baseline:left,relation:indexes.length?'ambiguous':'removed'})
  }
  b.forEach((right,i)=>{if(!used.has(i)&&!out.some(row=>row.relation==='ambiguous'&&stepSignature(row.baseline)===stepSignature(right)))out.push({target:right,relation:'added'})})
  return out
}
async function comparePng(root,aRun,bRun,a,b,artifacts){
  const af=evidence(a,'png'),bf=evidence(b,'png');if(!af||!bf)return dimension('unavailable','Screenshot evidence missing',af?[af.name]:[],bf?[bf.name]:[],undefined,'partial')
  try{const [ab,bb]=await Promise.all([readEvidence(root,aRun,af),readEvidence(root,bRun,bf)]),[ai,bi]=await Promise.all([sharp(ab,{limitInputPixels:16_000_000}).ensureAlpha().raw().toBuffer({resolveWithObject:true}),sharp(bb,{limitInputPixels:16_000_000}).ensureAlpha().raw().toBuffer({resolveWithObject:true})])
    if(ai.info.width!==bi.info.width||ai.info.height!==bi.info.height)return dimension('not-comparable','Screenshot size or orientation differs',[af.name],[bf.name],{baseline:`${ai.info.width}x${ai.info.height}`,target:`${bi.info.width}x${bi.info.height}`})
    const diff=Buffer.alloc(ai.data.length),masks=workerData.options?.masks??[];let pixels=0,minX=ai.info.width,minY=ai.info.height,maxX=-1,maxY=-1
    for(let y=0;y<ai.info.height;y++)for(let x=0;x<ai.info.width;x++){const masked=masks.some(m=>x>=m.x&&x<m.x+m.width&&y>=m.y&&y<m.y+m.height),i=(y*ai.info.width+x)*4;let changed=false;for(let c=0;c<4;c++){const d=Math.abs(ai.data[i+c]-bi.data[i+c]);diff[i+c]=c===3?255:d;changed ||= d>0}if(changed&&!masked){pixels++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}}
    if(!pixels)return dimension('same','Pixels are identical outside explicit masks',[af.name],[bf.name],{changedPixels:0,ratio:0,masks})
    const png=await sharp(diff,{raw:ai.info}).png().toBuffer();const name=`diff-${a.index}-${b.index}.png`;artifacts.push({name,contentType:'image/png',base64:png.toString('base64')});return dimension('different','Screenshot pixels differ',[af.name],[bf.name],{changedPixels:pixels,ratio:pixels/(ai.info.width*ai.info.height),bounds:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1},artifactName:name,masks})
  }catch(error){return dimension('unavailable',error.message,[af.name],[bf.name],undefined,'partial')}
}
function flattenXml(value,path='',out=[]){if(out.length>100_000)throw new Error('XML node budget exceeded');if(value&&typeof value==='object'){if(path.split('/').length>128)throw new Error('XML depth budget exceeded');for(const key of Object.keys(value).sort()){if(key.startsWith('@_'))out.push(`${path}|${key}=${String(value[key])}`);else if(Array.isArray(value[key]))value[key].forEach((item,i)=>flattenXml(item,`${path}/${key}[${i}]`,out));else flattenXml(value[key],`${path}/${key}`,out)}}else if(value!==undefined)out.push(`${path}|#=${String(value)}`);return out}
async function compareXml(root,aRun,bRun,a,b){const af=evidence(a,'xml'),bf=evidence(b,'xml');if(!af||!bf)return dimension('unavailable','Hierarchy evidence missing',af?[af.name]:[],bf?[bf.name]:[],undefined,'partial');try{const [ab,bb]=await Promise.all([readEvidence(root,aRun,af),readEvidence(root,bRun,bf)]);if(ab.length>8*1024*1024||bb.length>8*1024*1024)throw new Error('XML size budget exceeded');for(const bytes of [ab,bb])if(/<!DOCTYPE|<!ENTITY/i.test(bytes.toString('utf8')))throw new Error('DTD and entities are forbidden');const parser=new XMLParser({ignoreAttributes:false,processEntities:false,allowBooleanAttributes:true}),aa=flattenXml(parser.parse(ab.toString('utf8'))),ba=flattenXml(parser.parse(bb.toString('utf8')));const same=JSON.stringify(aa)===JSON.stringify(ba);return dimension(same?'same':'different',same?'Hierarchy is identical':'Hierarchy attributes or structure differ',[af.name],[bf.name],same?{entries:aa.length}:{baselineEntries:aa.length,targetEntries:ba.length})}catch(error){return dimension('unavailable',error.message,[af.name],[bf.name],undefined,'partial')}}
function compareFields(a,b){const ver=JSON.stringify(a?.verification??null)===JSON.stringify(b?.verification??null),timing=typeof a?.executionMs==='number'&&typeof b?.executionMs==='number';return {assertion:dimension(ver?'same':'different',ver?'Assertion result is identical':'Assertion declaration or result differs',[],[],{baseline:a?.verification,target:b?.verification}),timing:timing?dimension(a.executionMs===b.executionMs?'same':'different','Single-run timing comparison only',[],[],{baselineMs:a.executionMs,targetMs:b.executionMs,deltaMs:b.executionMs-a.executionMs,ratio:a.executionMs>0?b.executionMs/a.executionMs:null}):dimension('unavailable','Step timing missing',[],[],undefined,'partial')}}
function classifications(run){const rows=[];for(const d of run.diagnostics??[])rows.push({domain:d.domain,facts:[d.message],evidenceRefs:d.evidenceRefs});if(!rows.length&&run.verdict&&run.verdict!=='pass')rows.push({domain:'unknown',facts:['The run failed without a structured diagnostic'],evidenceRefs:[]});return rows}
function businessFacts(run){return{businessVerification:run.businessVerification,verifiers:(run.extensionResults??[]).filter(entry=>entry.role==='verify').map(entry=>({ref:entry.ref,status:entry.status,verdict:entry.result?.verdict,expectedMatchesActual:entry.result&&Object.hasOwn(entry.result,'expected')&&Object.hasOwn(entry.result,'actual')?JSON.stringify(entry.result.expected)===JSON.stringify(entry.result.actual):null}))}}
function recoveryFacts(run){return(run.aiRecovery?.attempts??[]).map(attempt=>({path:attempt.path,status:attempt.status,policy:attempt.policy,proposals:(attempt.proposals??[]).map(proposal=>({decision:proposal.decision,...(proposal.action?{action:proposal.action}:{})}))}))}
async function main(){const {baseline,target,root,comparable}=workerData;if(baseline.steps.length>1000||target.steps.length>1000)throw new Error('Step budget exceeded');const samePlan=baseline.comparison?.planDigest===target.comparison?.planDigest,artifacts=[],steps=[];let partial=false
  for(const row of align(baseline.steps,target.steps,samePlan)){if(row.relation!=='matched'){steps.push({baseline:row.baseline?.index,target:row.target?.index,relation:row.relation,path:row.baseline?.path??row.target?.path,dimensions:{alignment:dimension('different',row.relation)},divergent:true});continue}const fields=compareFields(row.baseline,row.target);let screenshot=dimension('not-comparable','Review-only comparison'),structure=dimension('not-comparable','Review-only comparison');if(comparable){screenshot=await comparePng(root,baseline,target,row.baseline,row.target,artifacts);structure=await compareXml(root,baseline,target,row.baseline,row.target)}partial ||= [screenshot,structure,fields.assertion,fields.timing].some(d=>d.completeness==='partial');const dimensions={screenshot,structure,...fields};steps.push({baseline:row.baseline.index,target:row.target.index,relation:'matched',path:row.baseline.path,dimensions,divergent:Object.values(dimensions).some(d=>d.status==='different')})}
  const runDimensions={business:JSON.stringify(businessFacts(baseline))===JSON.stringify(businessFacts(target)),cleanup:baseline.cleanup===target.cleanup&&baseline.resourceCleanup===target.resourceCleanup,recovery:JSON.stringify(recoveryFacts(baseline))===JSON.stringify(recoveryFacts(target))};steps.push({relation:'matched',path:'run',dimensions:Object.fromEntries(Object.entries(runDimensions).map(([k,v])=>[k,dimension(v?'same':'different',v?`${k} result is identical`:`${k} result differs`)])),divergent:Object.values(runDimensions).some(v=>!v)})
  return {report:{steps,classifications:classifications(target),limitations:[],partial},artifacts}
}
main().then(result=>parentPort.postMessage({ok:true,result})).catch(error=>parentPort.postMessage({ok:false,error:error instanceof Error?error.message:String(error)}))
