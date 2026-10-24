import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,sorted(item)])) : value
const canonical = value => JSON.stringify(sorted(value))
export async function approveBaseline(directory, imagePath, environment, review) {
  if (review?.type !== 'human' || !review.identity || !review.observation || review.observation.length < 20 || review.approved !== true) throw new Error('Explicit human baseline approval required')
  const bytes=await readFile(imagePath),metadata=await sharp(bytes).metadata()
  if(metadata.format!=='png'||review.sha256!==sha(bytes))throw new Error('Approval does not bind current PNG')
  for(const key of ['tool','browser','os','fonts','dpr','viewport','locale','fixture'])if(!environment[key])throw new Error(`Missing baseline environment: ${key}`)
  const id=sha(canonical({image:sha(bytes),environment,review})),root=join(resolve(directory),id)
  await mkdir(root,{recursive:true});await writeFile(join(root,'baseline.png'),bytes,{flag:'wx',mode:0o600})
  const manifest={schema:1,id,sha256:sha(bytes),environment,width:metadata.width,height:metadata.height,review,approvedAt:new Date().toISOString()}
  await writeFile(join(root,'approval.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});return manifest
}
export async function compareBaseline(baselineRoot, currentPath, environment, output, { colorDistance=0, maxChangedRatio=0 }={}) {
  if(!baselineRoot)return {status:'not-compared',reason:'No human-approved baseline'}
  if(!Number.isFinite(colorDistance)||colorDistance<0||colorDistance>1||!Number.isFinite(maxChangedRatio)||maxChangedRatio<0||maxChangedRatio>1)throw new Error('Invalid reviewed thresholds')
  const manifest=JSON.parse(await readFile(join(baselineRoot,'approval.json'),'utf8')),before=await readFile(join(baselineRoot,'baseline.png')),after=await readFile(currentPath)
  if(manifest.review?.type!=='human'||manifest.review?.approved!==true||sha(before)!==manifest.sha256)throw new Error('Unapproved or changed baseline')
  const a=await sharp(before).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(after).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  if(canonical(environment)!==canonical(manifest.environment)||a.info.width!==b.info.width||a.info.height!==b.info.height)return {status:'incomparable',reason:'Environment or dimensions differ',baseline:manifest.id}
  const diff=Buffer.alloc(a.data.length),total=a.info.width*a.info.height;let changed=0
  for(let i=0;i<a.data.length;i+=4){let distance=0;for(let c=0;c<4;c++)distance+=(a.data[i+c]-b.data[i+c])**2
    const different=Math.sqrt(distance)/(255*2)>colorDistance;if(different)changed++
    diff[i]=different?255:b.data[i];diff[i+1]=different?0:b.data[i+1];diff[i+2]=different?255:b.data[i+2];diff[i+3]=255}
  await mkdir(output,{recursive:true});await sharp(diff,{raw:{width:a.info.width,height:a.info.height,channels:4}}).png().toFile(join(output,'difference.png'))
  const result={status:changed/total>maxChangedRatio?'changed':'matched',baseline:manifest.id,currentSha256:sha(after),colorDistance,maxChangedRatio,changedPixels:changed,totalPixels:total,changedRatio:changed/total,requiresReview:changed>0}
  await writeFile(join(output,'comparison.json'),JSON.stringify(result,null,2));return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [command,...args]=process.argv.slice(2)
  if(command==='approve'&&args.length===4)console.log(JSON.stringify(await approveBaseline(args[0],args[1],JSON.parse(await readFile(args[2],'utf8')),JSON.parse(await readFile(args[3],'utf8'))),null,2))
  else if(command==='compare'&&args.length===4)console.log(JSON.stringify(await compareBaseline(args[0],args[1],JSON.parse(await readFile(args[2],'utf8')),args[3]),null,2))
  else throw new Error('Usage: baseline.mjs approve <root> <png> <environment.json> <human-review.json> | compare <approved-dir> <png> <environment.json> <output>')
}
