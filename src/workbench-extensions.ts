import { fork } from 'node:child_process'
import { type ExtensionSnapshot, validateShape } from './workbench-project.js'
export type { ExtensionResult } from './workbench-domain.js'
export const EXTENSION_WORKER_URL = new URL(import.meta.url.endsWith('.ts') ? '../scripts/workbench-extension.mjs' : './workbench-extension.js',import.meta.url)
export async function executeExtension(def: ExtensionSnapshot, args: unknown, signal: AbortSignal, register: (token: unknown)=>Promise<void>): Promise<unknown> {
  validateShape(def.input,args,'extension input'); signal.throwIfAborted()
  const env: Record<string,string> = { NO_COLOR:'1' }, secrets: string[] = []
  for(const [name,ref] of Object.entries(def.credentials)) { const value=process.env[ref]; if(!value) throw new Error(`Missing credential reference ${ref}`); env[name]=value;secrets.push(value) }
  const child = fork(EXTENSION_WORKER_URL,[],{env,execArgv:[],detached:process.platform!=='win32',stdio:['ignore','pipe','pipe','ipc']})
  let settled=false, bytes=0, queue=Promise.resolve(), stop!:()=>void
  const redact = (value: unknown) => {
    const json = JSON.stringify(value)
    if(json===undefined||Buffer.byteLength(json)>256*1024) throw new Error('Extension output exceeds 256 KiB or is invalid')
    if(secrets.some(secret=>json.includes(secret))) throw new Error('Extension attempted to publish credential data')
    return value
  }
  const kill = () => { try { if(process.platform!=='win32' && child.pid) process.kill(-child.pid,'SIGKILL'); else child.kill('SIGKILL') } catch { /* already exited */ } }
  const exited = new Promise<void>(resolve=>child.once('close',()=>resolve()))
  try {
    return await new Promise((resolve,reject)=> {
      const finish=(error?:unknown,value?:unknown)=> { if(settled)return;settled=true;error?reject(error):resolve(value) }
      stop=()=>finish(signal.reason??new Error('Cancelled'))
      const timer=setTimeout(()=>finish(new Error('Extension timed out')),def.timeoutMs)
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop)}
      child.once('close',()=>{cleanup();finish(new Error('Extension exited before a valid result'))})
      signal.addEventListener('abort',stop,{once:true})
      // Never forward extension stdout/stderr: they can contain credentials.
      const consume=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>256*1024)finish(new Error('Extension log limit exceeded'))}
      child.stdout!.on('data',consume);child.stderr!.on('data',consume)
      child.on('error',error=>finish(error))
      child.on('message',(event:any)=> {
        if(settled)return
        queue=queue.then(async()=> {
          if(settled)return
          if(Buffer.byteLength(JSON.stringify(event))>256*1024)throw new Error('Extension output exceeds 256 KiB')
          if(event.type==='resource') { await register(event.token); if(!settled)child.send({ack:event.id}) }
          else if(event.type==='result') { const value=redact(event.result); validateShape(def.output,value,'extension output');cleanup();finish(undefined,value) }
          else throw new Error('Extension execution failed')
        }).catch(error=>{cleanup();finish(error)})
      })
      child.send({source:def.source,args})
      if(signal.aborted)stop()
    })
  } finally { kill();await exited;await queue }
}
