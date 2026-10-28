import asyncio,json,subprocess,re,argparse
from pathlib import Path
import edge_tts
parser=argparse.ArgumentParser(description='Regenerate narration using Microsoft Edge online TTS; sends narration text to Microsoft.')
parser.add_argument('--online',action='store_true',help='Authorize sending narration text to Microsoft')
if not parser.parse_args().online:parser.error('Pass --online to send narration text to Microsoft. Existing video audio can be reused offline by render.mjs.')
source=Path(__file__).resolve().parent
root=source.parent/'.build'
(root/'assets').mkdir(parents=True,exist_ok=True)
voice='zh-CN-XiaoxiaoNeural'
segments=json.loads((source/'narration.json').read_text())
def duration(p):
 return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(p)]))
def normalized(s):return re.sub(r'[^\w]','',s,flags=re.U).lower()
async def generate(i,scene,rate):
 text=''.join(scene['parts'])
 path=root/f'assets/voice-{i}.mp3'
 boundaries=root/f'assets/voice-{i}-boundaries.json'
 request=root/f'assets/voice-{i}-request.json'
 config={'text':text,'voice':voice,'rate':rate,'pitch':'-1Hz'}
 if path.exists() and path.stat().st_size>0 and boundaries.exists() and request.exists() and json.loads(request.read_text())==config:
  return path,json.loads(boundaries.read_text()),duration(path)
 for attempt in range(3):
  tmp=path.with_suffix('.part.mp3');meta=[]
  try:
   communicate=edge_tts.Communicate(text,voice,rate=rate,volume='+0%',pitch='-1Hz',boundary='WordBoundary',connect_timeout=15,receive_timeout=30)
   with tmp.open('wb') as f:
    async for c in communicate.stream():
     if c['type']=='audio':f.write(c['data'])
     else:meta.append(c)
   seconds=duration(tmp)
   if seconds<=0 or not meta:raise RuntimeError('Empty voice response')
   tmp.replace(path)
   boundaries.write_text(json.dumps(meta,ensure_ascii=False,indent=2))
   request.write_text(json.dumps(config,ensure_ascii=False,indent=2))
   return path,meta,seconds
  except Exception as error:
   tmp.unlink(missing_ok=True)
   if attempt==2:raise
   print(f'Scene {i}: connection retry {attempt+1}/2 ({type(error).__name__})',flush=True)
   await asyncio.sleep(2*(attempt+1))
async def main():
 results=[];captions=[]
 for i,s in enumerate(segments):
  rate='+10%'; path,meta,seconds=await asyncio.wait_for(generate(i,s,rate),90)
  room=s['end']-s['start']-.65
  if seconds>room:
   rate='+14%';path,meta,seconds=await asyncio.wait_for(generate(i,s,rate),90)
  if seconds>room:raise RuntimeError(f'Scene {i} needs shorter copy: {seconds:.3f}s exceeds {room:.3f}s; no audio time-stretch applied')
  offset=s['start']+.3
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(path),'-af','highpass=f=65,loudnorm=I=-18:TP=-2:LRA=8','-ar','48000','-ac','1',str(root/f'assets/voice-{i}.wav')],check=True)
  threshold=len(normalized(s['parts'][0]));seen=0;split=None;first=None
  for m in meta:
   if m.get('type')!='WordBoundary':continue
   if first is None:first=m['offset']/1e7
   if seen>=threshold and split is None:split=m['offset']/1e7
   seen+=len(normalized(m['text']))
  if split is None:raise RuntimeError(f'Missing phrase boundary in scene {i}')
  captions.extend([[round(offset+(first or 0),3),round(offset+split,3),s['parts'][0].replace('Flow Assert','FlowAssert')],[round(offset+split,3),round(min(s['end']-.25,offset+seconds+.25),3),s['parts'][1]]])
  results.append({'scene':i,'voice':voice,'rate':rate,'duration':seconds,'start':offset,'end':offset+seconds,'timeStretch':False})
  print(json.dumps(results[-1],ensure_ascii=False),flush=True)
 (source/'captions.js').write_text('window.videoCaptions='+json.dumps(captions,ensure_ascii=False)+';')
 def stamp(t):
  ms=round(t*1000);return f'{ms//3600000:02}:{(ms//60000)%60:02}:{(ms//1000)%60:02},{ms%1000:03}'
 (source.parent/'flowassert-introduction.zh-CN.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{t}' for i,(a,b,t) in enumerate(captions))+'\n')
 (root/'voice-metadata.json').write_text(json.dumps({'engine':'Microsoft Edge neural TTS via edge-tts','version':edge_tts.__version__,'cloudTextSent':True,'payloadScope':'Only six narration paragraphs; no source code, screenshots or account data','segments':results},ensure_ascii=False,indent=2))
asyncio.run(main())
