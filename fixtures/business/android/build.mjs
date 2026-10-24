import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
const sdk = process.env.ANDROID_HOME
if (!sdk) throw new Error('Set ANDROID_HOME explicitly')
const buildTools = resolve(sdk, 'build-tools', process.env.ANDROID_BUILD_TOOLS ?? '33.0.2')
const android = resolve(sdk, 'platforms', process.env.ANDROID_PLATFORM ?? 'android-33', 'android.jar')
const out = resolve(root, '../../../artifacts/fixture/android')
mkdirSync(resolve(out, 'classes'), { recursive: true }); mkdirSync(resolve(out, 'dex'), { recursive: true })
const run = (file, args) => execFileSync(file, args, { stdio: 'inherit', cwd: out })
run('javac', ['-source','8','-target','8','-classpath',android,'-d',resolve(out,'classes'),resolve(root,'MainActivity.java')])
const classes = readdirSync(resolve(out,'classes/dev/mobilemirror/fixture')).filter(f => f.endsWith('.class')).map(f => resolve(out,'classes/dev/mobilemirror/fixture',f))
run(resolve(buildTools,'d8'), ['--lib',android,'--min-api','26','--output',resolve(out,'dex'),...classes])
run(resolve(buildTools,'aapt'), ['package','-f','-M',resolve(root,'AndroidManifest.xml'),'-I',android,'-F',resolve(out,'unsigned.apk')])
execFileSync(resolve(buildTools,'aapt'), ['add',resolve(out,'unsigned.apk'),'classes.dex'], { cwd: resolve(out,'dex'), stdio:'inherit' })
run(resolve(buildTools,'zipalign'), ['-f','4','unsigned.apk','aligned.apk'])
const key = resolve(out,'debug.keystore')
if (!existsSync(key)) run('keytool', ['-genkeypair','-keystore',key,'-storepass','android','-keypass','android','-alias','fixture','-dname','CN=FlowAssert Fixture','-keyalg','RSA','-validity','3650'])
run(resolve(buildTools,'apksigner'), ['sign','--ks',key,'--ks-pass','pass:android','--out','fixture.apk','aligned.apk'])
run(resolve(buildTools,'apksigner'), ['verify','fixture.apk'])
console.log(resolve(out,'fixture.apk'))
