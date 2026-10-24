import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'

test('recovery progress remains interactive and the retained original failure survives restart', async ({page})=>{
  const root=await mkdtemp(join(tmpdir(),'mirror-recovery-ui-'))
  class NavigationFixture extends MockProvider {
    override async screenSource(): ReturnType<MockProvider['screenSource']> {
      const source=await super.screenSource()
      if(source.kind==='normalized')source.structure.nodes=source.structure.nodes.filter(n=>!n.sensitive)
      return source
    }
  }
  const config=resolveMirrorConfig({viewerPort:0,mockStartupDelayMs:0})
  const service=new MirrorService(config,'http://127.0.0.1',{providerFactory:()=>new NavigationFixture(0)})
  const projectPath=join(root,'project.json')
  await writeFile(projectPath,JSON.stringify({recoveryModels:{vision:{endpoint:'http://127.0.0.1:9/completions',model:'UI-fixture',apiKeyEnv:'UNUSED'}},recoveryPolicies:{nav:{mode:'auto',platform:'ios',appId:'com.example.mobilemirror.mock',intent:'Open navigation',modelRef:'vision',navigationOnly:true,allowImageSharing:true,page:{text:'Hello, harness.'},allowedTargets:[{accessibilityId:'action-card'}]}}}))
  let release!:()=>void
  let viewer=new ViewerServer(config,{service,assistant:null,disposeServiceOnClose:false,workbenchRoot:join(root,'runs'),workbenchProjectPath:projectPath,recoveryPlanner:async input=>{
    await new Promise<void>(resolve=>{release=resolve})
    return {decision:'propose',observationId:input.id,action:{kind:'tap',nodeId:input.candidates[0]!.nodeId},reason:'Navigation fixture candidate'}
  }})
  try {
    await viewer.listen();await service.start({provider:'mock'});await page.goto(viewer.url)
    await page.locator('#language-select').selectOption('zh-CN');await page.locator('#workbench-toggle').click()
    await page.locator('#wb-yaml').fill('name: AI navigation recovery\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- recover:\n    id: search\n    policy: nav\n    step:\n      tap: {accessibilityId: old-id}\n    postcondition:\n      visible: {text: "1 actions received"}\n')
    await page.locator('#wb-run').click()
    await expect(page.locator('.wb-stage')).toHaveText('正在分析候选入口')
    await expect.poll(()=>typeof release).toBe('function')
    await page.locator('#theme-button').click();await expect(page.locator('body')).toHaveClass(/light-stage/)
    await page.locator('#wb-refresh').click();await expect(page.locator('#device-frame')).toBeVisible()
    release()
    await expect(page.locator('#wb-detail .wb-verdict')).toHaveText('AI 恢复后完成（CI 非通过）',{timeout:20000})
    await expect(page.locator('.wb-ai-recovery')).toContainText('Navigation fixture candidate')
    await expect(page.locator('.wb-step').first()).toContainText('target-not-found')
    await page.setViewportSize({width:1440,height:1200})
    await page.locator('#wb-detail').scrollIntoViewIfNeeded()
    await page.screenshot({path:'artifacts/screenshots/mobile-mirror-ai-recovery.png'})
    const id=await page.locator('.wb-run-id').textContent()
    await viewer.close()
    viewer=new ViewerServer(config,{service,assistant:null,disposeServiceOnClose:false,workbenchRoot:join(root,'runs'),workbenchProjectPath:projectPath})
    await viewer.listen();await page.goto(viewer.url);await page.locator('#language-select').selectOption('zh-CN');await page.locator('#workbench-toggle').click()
    await expect(page.locator('.wb-run-id')).toHaveText(id!)
    await expect(page.locator('#wb-detail .wb-verdict')).toHaveText('AI 恢复后完成（CI 非通过）')
  } finally {release?.();await viewer.close();await service.dispose();await rm(root,{recursive:true,force:true})}
})
