// Trusted, self-contained ESM extension runner. Process isolation is NOT a sandbox.
import { registerHooks } from 'node:module'
process.once('disconnect', () => {
  // Parent death cannot leave a trusted extension or its children running.
  try { if(process.platform !== 'win32') process.kill(-process.pid,'SIGKILL') } finally { process.exit(1) }
})
let used = false
process.on('message', async (request) => {
  if (used) return
  used = true
  try {
    const entry = `data:text/javascript;base64,${Buffer.from(request.source).toString('base64')}`
    registerHooks({resolve(specifier, context, nextResolve) {
      if (specifier === entry || specifier.startsWith('node:')) return nextResolve(specifier, context)
      throw new Error('Extensions must be bundled; only node: imports are allowed')
    }})
    const module = await import(entry)
    const registrations = new Map(); let id = 0
    process.on('message', message => { if(message.ack) { const entry=registrations.get(message.ack); if(entry) { registrations.delete(message.ack); message.error ? entry.reject(new Error(message.error)) : entry.resolve() } } })
    const result = await module.default(request.args, {
      registerCleanup(token) { return new Promise((resolve,reject)=> { const current=++id; registrations.set(current,{resolve,reject}); process.send({type:'resource',id:current,token}) }) },
    })
    process.send({type:'result',result})
  } catch { process.send({type:'error',error:'Extension failed; inspect the registered module in the trusted project'}) }
})
