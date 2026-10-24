import { afterEach, expect, it, vi } from 'vitest'
import { boundedProposal, planRecovery, recoveryModelSchema, recoveryPolicySchema, type RecoveryObservation, type RecoveryPolicy } from '../src/workbench-recovery.js'

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs()})
const model={endpoint:'https://model.example/v1/chat/completions',model:'vision-fixture',apiKeyEnv:'MIRROR_TEST_VISION_KEY'}
const policy:RecoveryPolicy={mode:'auto',platform:'ios',appId:'fixture',intent:'Open Search',modelRef:'vision',navigationOnly:true,allowImageSharing:true,page:{text:'Synthetic fixture'},allowedTargets:[{text:'Search'}]}
const input={id:'observation',image:'',candidates:[{nodeId:'search'}],geometry:{viewport:{x:0,y:0,width:390,height:844}}} as unknown as RecoveryObservation
const suggestion={decision:'propose',observationId:input.id,action:{kind:'tap',nodeId:'search'},reason:'Search navigation'}
it('sends only registered image/candidates, keeps credentials out of the body and records actual usage',async()=>{
  vi.stubEnv(model.apiKeyEnv,'synthetic-secret')
  const request=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(suggestion)}}],usage:{prompt_tokens:500,completion_tokens:50}})))
  const usage=vi.fn()
  const result=await boundedProposal(planRecovery,input,policy,model,new AbortController().signal,usage)
  expect(result).toEqual(suggestion)
  const options=request.mock.calls[0]![1]!
  expect(options.redirect).toBe('error');expect(options.body).not.toContain('synthetic-secret')
  const body=JSON.parse(String(options.body));expect(body.max_tokens).toBe(1024);expect(body.tools).toBeUndefined()
  expect(body.messages[1].content[1].type).toBe('image_url')
  expect(body.thinking).toBeUndefined()
  expect(usage).toHaveBeenCalledWith({inputTokens:500,outputTokens:50})
})
it('uses the explicitly registered DeepSeek thinking switch without changing budgets or granting tools',async()=>{
  vi.stubEnv(model.apiKeyEnv,'synthetic-secret')
  const request=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(suggestion)}}]})))
  const configured=recoveryModelSchema.parse({...model,thinking:'disabled'})
  await planRecovery(input,policy,configured,new AbortController().signal)
  const body=JSON.parse(String(request.mock.calls[0]![1]!.body))
  expect(body.thinking).toEqual({type:'disabled'})
  expect(body.max_tokens).toBe(1024);expect(body.tools).toBeUndefined()
  expect(()=>recoveryModelSchema.parse({...model,thinking:'arbitrary'})).toThrow()
})
it('does not invent zero usage or reveal remote error bodies',async()=>{
  vi.stubEnv(model.apiKeyEnv,'synthetic-secret')
  const request=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(suggestion)}}]}))).mockResolvedValueOnce(new Response('private diagnostic',{status:503}))
  const usage=vi.fn()
  await planRecovery(input,policy,model,new AbortController().signal,usage)
  expect(usage).not.toHaveBeenCalled()
  await expect(planRecovery(input,policy,model,new AbortController().signal)).rejects.toThrow('Model HTTP 503')
  expect(request).toHaveBeenCalledTimes(2)
})
it('rejects missing credentials and oversized images before any request',async()=>{
  vi.stubEnv(model.apiKeyEnv,undefined)
  const request=vi.spyOn(globalThis,'fetch')
  await expect(planRecovery(input,policy,model,new AbortController().signal)).rejects.toThrow('credential')
  await expect(boundedProposal(planRecovery,{...input,image:Buffer.alloc(2*1024*1024+1).toString('base64')},policy,model,new AbortController().signal)).rejects.toThrow('budget')
  expect(request).not.toHaveBeenCalled()
})
it('requires explicit image sharing and rejects embedded credentials and remote cleartext endpoints',()=>{
  expect(()=>recoveryPolicySchema.parse({...policy,allowImageSharing:false})).toThrow()
  expect(()=>recoveryPolicySchema.parse({...policy,page:undefined})).toThrow()
  expect(()=>recoveryModelSchema.parse({...model,endpoint:'https://secret@model.example/v1'})).toThrow()
  expect(()=>recoveryModelSchema.parse({...model,endpoint:'http://model.example/v1'})).toThrow()
  expect(()=>recoveryModelSchema.parse({...model,apiKey:'inline-secret'})).toThrow()
})
