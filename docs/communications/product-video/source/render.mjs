import { chromium } from '@playwright/test';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, access, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
const root=fileURLToPath(new URL('.',import.meta.url));
const output=resolve(root,'..');
const build=join(output,'.build');
await mkdir(join(build,'qa'),{recursive:true});
const video=join(output,'flowassert-introduction.zh-CN.mp4');
const soundtrack=join(build,'soundtrack.wav');
const preview=process.argv.includes('--preview');
if(!preview){
 try{await access(soundtrack)}catch{
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',video,'-vn','-ar','48000','-ac','2',soundtrack]);
 }
}
const browser=await chromium.launch({headless:true,args:['--hide-scrollbars']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(pathToFileURL(join(root,'film.html')).href+'?render');
await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))});
if(preview){
 for(const t of [2.5,10.5,19.5,27,35,42]){await page.evaluate(t=>window.renderAt(t),t);await page.screenshot({path:join(build,'qa',`scene-${t}.png`)});}
 const report=await page.evaluate(()=>({missingImages:[...document.images].filter(x=>!x.naturalWidth).map(x=>x.src),viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},text:[...document.querySelectorAll('.scene-head h2,.closing h2')].map(x=>x.textContent)}));
 await writeFile(join(build,'qa','render-checks.json'),JSON.stringify({errors,...report},null,2));
 console.log(JSON.stringify({errors,...report}));
}else{
 const ff=spawn('ffmpeg',['-hide_banner','-loglevel','warning','-y','-f','image2pipe','-vcodec','mjpeg','-framerate','30','-i','pipe:0','-i',soundtrack,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-t','46','-movflags','+faststart','-metadata','title=FlowAssert 产品介绍','-metadata','comment=Mock demonstration; edited presentation; Developer Preview. Microsoft Xiaoxiao neural Chinese narration at +10 percent rate; original electronic pulse soundtrack with speech ducking.',join(build,'rendered.mp4')],{stdio:['pipe','ignore','inherit']});
 const finished=once(ff,'close');
 for(let f=0;f<1380;f++){
  await page.evaluate(t=>window.renderAt(t),f/30);
  const frame=await page.screenshot({type:'jpeg',quality:95});
  if(!ff.stdin.write(frame))await once(ff.stdin,'drain');
  if(f%150===0)console.log(`Rendered ${f}/1380 frames (${(f/30).toFixed(1)}s)`,new Date().toISOString());
 }
 ff.stdin.end();const [code]=await finished;if(code)throw new Error(`ffmpeg exit ${code}`);
 execFileSync('ffmpeg',['-v','error','-i',join(build,'rendered.mp4'),'-f','null','-']);
 const {copyFile}=await import('node:fs/promises');await copyFile(join(build,'rendered.mp4'),video);
 console.log('Completed video render',JSON.stringify({errors}));
}
await browser.close();
