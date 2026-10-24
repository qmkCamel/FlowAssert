import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url)), sdk = process.env.ANDROID_HOME
if (!sdk) throw new Error('Set ANDROID_HOME explicitly')
const tools = resolve(sdk, 'build-tools', process.env.ANDROID_BUILD_TOOLS ?? '33.0.2')
const android = resolve(sdk, 'platforms', process.env.ANDROID_PLATFORM ?? 'android-33', 'android.jar')
const out = resolve(root, '../../../artifacts/fixture/runtime-android')
mkdirSync(resolve(out, 'classes'), { recursive: true }); mkdirSync(resolve(out, 'dex'), { recursive: true })
const run = (file, args, cwd = out) => execFileSync(file, args, { stdio: 'inherit', cwd })
run('javac', ['-source', '8', '-target', '8', '-classpath', android, '-d', resolve(out, 'classes'), resolve(root, 'MainActivity.java')])
const classes = readdirSync(resolve(out, 'classes/dev/mobilemirror/runtimefixture')).filter(file => file.endsWith('.class')).map(file => resolve(out, 'classes/dev/mobilemirror/runtimefixture', file))
run(resolve(tools, 'd8'), ['--lib', android, '--min-api', '26', '--output', resolve(out, 'dex'), ...classes])
run(resolve(tools, 'aapt'), ['package', '-f', '-M', resolve(root, 'AndroidManifest.xml'), '-I', android, '-F', resolve(out, 'unsigned.apk')])
run(resolve(tools, 'aapt'), ['add', resolve(out, 'unsigned.apk'), 'classes.dex'], resolve(out, 'dex'))
run(resolve(tools, 'zipalign'), ['-f', '4', 'unsigned.apk', 'aligned.apk'])
const key = resolve(out, 'debug.keystore')
if (!existsSync(key)) run('keytool', ['-genkeypair', '-keystore', key, '-storepass', 'android', '-keypass', 'android', '-alias', 'fixture', '-dname', 'CN=FlowAssert Runtime Fixture', '-keyalg', 'RSA', '-validity', '3650'])
run(resolve(tools, 'apksigner'), ['sign', '--ks', key, '--ks-pass', 'pass:android', '--out', 'fixture.apk', 'aligned.apk'])
run(resolve(tools, 'apksigner'), ['verify', 'fixture.apk'])
console.log(resolve(out, 'fixture.apk'))
