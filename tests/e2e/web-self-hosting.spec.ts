import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test,expect } from '@playwright/test'
import { ViewerServer } from '../../src/viewer-server.js'
import { resolveMirrorConfig } from '../../src/mcp-config.js'

test('optional typed Web authoring preserves local case revisions and leaves device navigation usable',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'web-authoring-e2e-')),viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:root,webTests:true})
  try{await viewer.listen();await page.goto(`${viewer.url}/#/cases`);await page.locator('#journey-new-web').click()
    await page.locator('#web-case-name').fill('Synthetic regression');await page.locator('#web-evidence-consent').check();await page.locator('#web-save').click()
    await expect(page.locator('#journey-edit')).toContainText(/修订已保存|Revision saved/)
    const cases=await viewer.application.cases.list();expect(cases.cases).toHaveLength(1);expect(cases.cases[0]).toMatchObject({platform:'web',name:'Synthetic regression'});expect(cases.cases[0]).not.toHaveProperty('appId')
    const path='artifacts/screenshots/web-case-saved.png';await page.screenshot({path,fullPage:true});await test.info().attach('web-case-saved',{path,contentType:'image/png'})
    await page.locator('.journey-nav a[href="#/devices"]').click();await expect(page.locator('.control-panel')).toBeVisible()
    await page.goto(`${viewer.url}/#/cases/${cases.cases[0]!.caseId}/edit`);await expect(page.locator('#web-case-name')).toHaveValue('Synthetic regression')
  }finally{await viewer.close();await rm(root,{recursive:true,force:true})}
})
test('Web creation entry is absent when optional capability is disabled',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'web-disabled-e2e-')),viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:root,webTests:false})
  try{await viewer.listen();await page.goto(`${viewer.url}/#/cases`);await expect(page.locator('#journey-new')).toBeVisible();await expect(page.locator('#journey-new-web')).toBeHidden()}
  finally{await viewer.close();await rm(root,{recursive:true,force:true})}
})
