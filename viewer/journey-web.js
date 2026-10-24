import { api, node, button, field, copy } from './journey-common.js'

export function createWebAuthoring(root, navigate) {
  let record = null, revision = null, dirty = false, busy = false, enabled = false, requestId = crypto.randomUUID()
  const status = node('p'), form = node('section'), actions = node('div', undefined, 'journey-actions')
  status.setAttribute('role','status'); root.append(node('h1', copy('Web 合成自检用例','Web synthetic self-test')), node('p',copy('独立 B 实例，仅合成历史；不会访问手机或当前用户归档。需要单独复核截图。','Independent synthetic B instance; no phone or user archive access. Screenshots require separate review.')),form,actions,status)
  const name = field(form,'用例名称','Case name','web-case-name','Viewer 视觉验收'), selected = new Map()
  const labels = ['首屏','播放控制','时间线与失败','动作前后','缺图恢复','慢图竞态','窄屏双语','键盘与 CSS 200%']
  for (let i=1;i<=8;i++) { const id = `VA-0${i}`, box = node('input'); box.type='checkbox'; box.value=id; box.checked=[1,4,5].includes(i); const label=node('label',`${id} · ${labels[i-1]}`); label.prepend(box); form.append(label); selected.set(id,box) }
  const fault = node('select'); fault.id='web-calibration'; fault.setAttribute('aria-label','Calibration fault')
  for (const value of ['none','covered-play','shifted-marker','hidden-retry','narrow-overflow']) { const option=node('option', value); option.value=value; fault.append(option) }
  form.append(node('label',copy('夹具校准（正常 / 故障注入）','Fixture calibration (normal / injected fault)')), fault)
  const consent=node('input'); consent.type='checkbox';consent.id='web-evidence-consent'; const consentLabel=node('label',copy('允许本机保存合成截图、页面结构和运行日志','Allow local synthetic screenshots, page structure, and logs')); consentLabel.prepend(consent); form.append(consentLabel)
  form.addEventListener('input',()=>{ dirty=true; requestId=crypto.randomUUID() })
  async function save() {
    if (!consent.checked) throw new Error(copy('请先确认本机材料保存','Confirm local evidence storage first'))
    const content={name:name.value,tags:['web-selftest'],executionKind:'web',platform:'web',target:'synthetic-viewer',scenarioVersion:1,scenarios:[...selected].filter(([,box])=>box.checked).map(([id])=>id),calibration:fault.value}
    const saved=await api(record?`/api/workbench/cases/${record.caseId}/revisions`:'/api/workbench/cases',{requestId,expectedRevision:record?.headRevision??null,content,publicData:true})
    record={caseId:saved.caseId,headRevision:saved.revisionId}; revision=saved.revisionId; dirty=false; requestId=crypto.randomUUID(); document.dispatchEvent(new Event('journey:cases-changed')); return saved
  }
  async function perform(run) {
    if(busy)return; busy=true; saveButton.disabled=runButton.disabled=true; status.textContent=copy(run?'正在保存并启动…仍可浏览其他记录':'正在保存修订…','Saving revision… other records remain available')
    try { const saved=await save(); if(run) { const result=await api('/api/runs',{executionKind:'web',localEvidence:true,requestId:crypto.randomUUID(),caseId:saved.caseId,revisionId:saved.revisionId}); navigate(`#/runs/${result.id}`) } else status.textContent=copy('修订已保存','Revision saved') }
    catch(error){status.textContent=error.message}finally{busy=false;saveButton.disabled=false;runButton.disabled=!enabled}
  }
  const saveButton=button('保存修订','Save revision',()=>void perform(false),'web-save'),runButton=button('保存并开始 Web 验收','Save and start Web acceptance',()=>void perform(true),'web-start')
  actions.append(saveButton,runButton)
  return { setEnabled(value){enabled=value;runButton.disabled=!enabled||busy}, mayReplace(){return !dirty||window.confirm(copy('放弃未保存的 Web 用例修改？','Discard unsaved Web case changes?'))}, async open(id) {
    if(!this.mayReplace())return false
    record=id?await api(`/api/workbench/cases/${id}`):null
    const value=record?await api(`/api/workbench/cases/${id}/revisions/${record.headRevision}`):null
    if(value&&value.platform!=='web')throw new Error('Web revision required')
    name.value=value?.name??'Viewer 视觉验收';fault.value=value?.calibration??'none';revision=record?.headRevision??null
    for(const [id,box]of selected)box.checked=(value?.scenarios??['VA-01','VA-04','VA-05']).includes(id)
    consent.checked=false;dirty=false;status.textContent='';requestId=crypto.randomUUID();return true
  } }
}

export function renderWebReport(root, run, navigate, refresh) {
  root.dataset.runId=run.id
  root.replaceChildren(); root.append(node('h2',copy('Web 验收 · 合成被测历史 · 非真机','Web acceptance · Synthetic target history · Not a device run')))
  const state=node('p',`${run.phase} · ${run.verdict??'inconclusive'} · visual: ${run.visualReview.status} · independent: ${run.independentCheck} · baseline: ${run.baseline}`);state.id='web-run-status';state.setAttribute('role','status');root.append(state)
  root.append(node('p',copy('CLI 完成不是视觉通过。比较、分享、导入、修复和设备健康：本期不适用。','CLI completion is not visual approval. Native compare, share, import, repair, and device health are not applicable.')))
  if(run.error)root.append(node('p',run.error,'wb-error'))
  const resources=node('details');resources.append(node('summary',copy('A/B 身份和资源清理','A/B identity and cleanup')),node('pre',JSON.stringify({...run.resources,cleanup:run.cleanup,environment:run.environment},null,2)));root.append(resources)
  if(run.phase!=='finished'){
    root.append(node('p',copy('正在取证；可取消，也可浏览其他历史。已保存截图会持续显示。','Collecting evidence; cancellation and other history remain available. Saved screenshots appear as they arrive.')))
    const cancel=button('取消 Web 验收','Cancel Web acceptance',async()=>{cancel.disabled=true;cancel.textContent=copy('正在取消并排空…','Cancelling and draining…');try{await api(`/api/runs/${run.id}/cancel`,{});refresh()}catch(error){state.textContent=error.message;cancel.disabled=false}},'web-cancel');root.append(cancel)
  }
  const images=[]
  for(const step of run.steps){
    const section=node('details');section.open=step.index===1||step.status==='running'||step.status==='failed';section.append(node('summary',`${step.index}. ${step.kind} · ${step.status}`));if(step.error)section.append(node('p',step.error,'wb-error'))
    for(const check of step.checks)section.append(node('p',`${check.pass?'✓':'✗'} ${check.name}`))
    for(const file of step.evidence){const url=`/api/runs/${run.id}/artifacts/${encodeURIComponent(file.name)}`
      if(file.contentType==='image/png'){images.push(file);const figure=node('figure'),img=node('img');img.alt=file.name;img.src=url;img.loading='lazy';img.style.maxWidth='100%';figure.append(node('figcaption',`${file.name} · ${file.sha256.slice(0,12)}`),img);section.append(figure)}
      else{const a=node('a',file.name);a.href=url;a.download=file.name;section.append(a,node('br'))}
    }root.append(section)
  }
  if(run.phase==='finished') {
    const retry=button('创建新的尝试','Create new attempt',async()=>{retry.disabled=true;retry.textContent=copy('正在启动新尝试…','Starting new attempt…');try{const result=await api('/api/runs',{executionKind:'web',localEvidence:true,requestId:crypto.randomUUID(),caseId:run.authoringOrigin.caseId,revisionId:run.authoringOrigin.revisionId,parentRunId:run.id});navigate(`#/runs/${result.id}`)}catch(error){retry.disabled=false;state.textContent=error.message}});root.append(retry)
  }
  if(run.phase!=='finished'||run.visualReview.status!=='needs-review'||run.verdict==='cancelled'||run.recovery||!images.length)return
  const review=node('section');review.append(node('h3',copy('实际截图复核','Actual screenshot review')))
  const reviewer=field(review,'复核人 / Agent 身份','Reviewer / Agent identity','web-reviewer'),notes=field(review,'逐场景观察与未验边界','Per-scenario observations and limits','web-review-notes')
  const approved=node('input');approved.type='checkbox';const label=node('label',copy('我已查看以上所有截图，结论引用实际画面','I inspected all screenshots above; observations refer to actual images'));label.prepend(approved);review.append(label)
  const submit=async(status)=>{if(!approved.checked){state.textContent=copy('必须先实际查看截图','Inspect the screenshots first');return}pass.disabled=fail.disabled=true;state.textContent=copy('正在校验材料与保存复核…','Verifying evidence and saving review…');try{await api(`/api/runs/${run.id}/web-review`,{status,reviewer:reviewer.value,observations:notes.value,hashes:images.map(f=>f.sha256),reviewedImages:true});refresh()}catch(error){state.textContent=error.message;pass.disabled=fail.disabled=false}}
  const pass=button('视觉复核通过','Visual review passed',()=>void submit('pass'),'web-review-pass'),fail=button('记录视觉问题','Record visual failure',()=>void submit('fail'),'web-review-fail');review.append(pass,fail);root.append(review)
}
