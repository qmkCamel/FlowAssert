import { it,expect } from 'vitest'
import { mkdtemp,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { approveBaseline,compareBaseline } from '../../scripts/web-visual-acceptance/baseline.mjs'
it('requires explicit approval; preserves baseline on differences; rejects incompatible environments',async()=>{
  const root=await mkdtemp(join(tmpdir(),'baseline-test-')),environment={tool:'test',browser:'test',os:'test',fonts:'test',dpr:1,viewport:'10x10',locale:'en',fixture:'synthetic-unit'}
  try{const a=await sharp({create:{width:10,height:10,channels:4,background:'#fff'}}).png().toBuffer(),b=await sharp({create:{width:10,height:10,channels:4,background:'#000'}}).png().toBuffer();await writeFile(join(root,'a.png'),a);await writeFile(join(root,'b.png'),b)
    expect((await compareBaseline(null,join(root,'a.png'),environment,root)).status).toBe('not-compared')
    await expect(approveBaseline(root,join(root,'a.png'),environment,{})).rejects.toThrow('human')
    const baseline=await approveBaseline(root,join(root,'a.png'),environment,{type:'human',identity:'unit-test-fixture-only',observation:'Synthetic unit approval, not a product visual review',approved:true,sha256:createHash('sha256').update(a).digest('hex')})
    expect((await compareBaseline(join(root,baseline.id),join(root,'a.png'),environment,join(root,'same'))).status).toBe('matched')
    expect((await compareBaseline(join(root,baseline.id),join(root,'b.png'),environment,join(root,'changed'))).status).toBe('changed')
    expect((await compareBaseline(join(root,baseline.id),join(root,'a.png'),{...environment,dpr:2},root)).status).toBe('incomparable')
  }finally{await rm(root,{recursive:true,force:true})}
})
