import { execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { resolve, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, X509Certificate } from 'node:crypto'

// Offline signing only: never register devices or request/update profiles.
const root = dirname(fileURLToPath(import.meta.url))
const profile = process.env.FIXTURE_PROVISIONING_PROFILE
const device = process.env.MOBILE_MIRROR_DEVICE_ID
const identity = process.env.FIXTURE_SIGN_IDENTITY
if (!profile || !isAbsolute(profile) || !device || !/^[a-fA-F0-9]{40}$/.test(identity ?? '')) {
  throw new Error('Explicit absolute FIXTURE_PROVISIONING_PROFILE, DEVICE_ID and SIGN_IDENTITY SHA-1 required')
}
const decoded = execFileSync('security', ['cms', '-D', '-i', profile])
const extract = (key, format = 'json') => execFileSync('plutil', ['-extract', key, format, '-o', '-', '-'], { input: decoded, encoding: 'utf8' }).trim()
const entitlements = JSON.parse(extract('Entitlements'))
const team = JSON.parse(extract('TeamIdentifier'))[0]
const bundle = 'dev.mobilemirror.runtimefixture'
const allowed = entitlements['application-identifier']
if (new Date(extract('ExpirationDate', 'raw')).getTime() <= Date.now()
  || !JSON.parse(extract('ProvisionedDevices')).includes(device)
  || entitlements['get-task-allow'] !== true
  || ![team + '.*', team + '.' + bundle].includes(allowed)) throw new Error('Existing development profile does not authorize this device/App')
const certificates = [...extract('DeveloperCertificates', 'xml1').matchAll(/<data>([\s\S]*?)<\/data>/g)]
  .map(match => new X509Certificate(Buffer.from(match[1].replace(/\s/g, ''), 'base64')))
if (!certificates.some(certificate => certificate.fingerprint.replaceAll(':', '').toLowerCase() === identity.toLowerCase()
  && new Date(certificate.validTo).getTime() > Date.now())) throw new Error('Signing identity does not match a valid supplied profile certificate')
const out = resolve(root, '../../../artifacts/fixture', 'runtime-ios-' + new Date().toISOString().replace(/[:.]/g, '-'))
const app = resolve(out, 'RuntimeFixture.app')
mkdirSync(app, { recursive: true, mode: 0o700 })
copyFileSync(resolve(root, 'Info.plist'), resolve(app, 'Info.plist'))
copyFileSync(profile, resolve(app, 'embedded.mobileprovision'))
chmodSync(resolve(app, 'embedded.mobileprovision'), 0o600)
const sdk = execFileSync('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8' }).trim()
execFileSync('xcrun', ['--sdk', 'iphoneos', 'swiftc', '-parse-as-library', '-sdk', sdk, '-target', 'arm64-apple-ios16.0',
  '-module-name', 'RuntimeFixture', '-Xlinker', '-rpath', '-Xlinker', '@executable_path/Frameworks',
  resolve(root, 'RuntimeFixture.swift'), '-o', resolve(app, 'RuntimeFixture')], { stdio: 'inherit' })
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const appIdentifier = team + '.' + bundle
const entitlementPath = resolve(out, 'entitlements.plist')
writeFileSync(entitlementPath, '<?xml version="1.0"?><plist version="1.0"><dict>'
  + '<key>application-identifier</key><string>' + xml(appIdentifier) + '</string>'
  + '<key>com.apple.developer.team-identifier</key><string>' + xml(team) + '</string>'
  + '<key>get-task-allow</key><true/>'
  + '<key>keychain-access-groups</key><array><string>' + xml(appIdentifier) + '</string></array>'
  + '</dict></plist>', { mode: 0o600 })
execFileSync('codesign', ['--sign', identity, '--entitlements', entitlementPath, app], { stdio: 'inherit' })
execFileSync('codesign', ['--verify', '--strict', app], { stdio: 'inherit' })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const provenance = { scope: 'synthetic-ios-physical', bundle, version: '1.1',
  binarySha256: hash(readFileSync(resolve(app, 'RuntimeFixture'))),
  sourceSha256: hash(readFileSync(resolve(root, 'RuntimeFixture.swift'))),
  profileSha256: hash(readFileSync(profile)), offlineSigning: true }
writeFileSync(resolve(out, 'identity.json'), JSON.stringify(provenance, null, 2), { mode: 0o600 })
console.log('Private signed fixture: ' + app)
