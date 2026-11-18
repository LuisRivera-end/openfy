import { build } from 'esbuild'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dest = resolve(process.argv[2] || resolve(root, 'android/app/build/generated/provider-assets/provider'))
await mkdir(dest, { recursive: true })
await build({
  entryPoints: [resolve(root, 'android/provider-js/index.ts')],
  outfile: resolve(dest, 'openfy-provider.js'), bundle: true, format: 'iife',
  platform: 'browser', target: 'es2022', keepNames: true, minify: false,
  alias: { 'node:crypto': resolve(root, 'android/provider-js/crypto.ts') },
  plugins: [{ name: 'android-decipher', setup(b) {
    b.onResolve({ filter: /^youtubei\.js$/ }, () => ({ path: resolve(root, 'android/provider-js/platform.ts') }))
    b.onResolve({ filter: /^\.\/youtube-evaluator$/ }, () => ({ path: resolve(root, 'android/provider-js/evaluator.ts') }))
  } }],
  define: { 'process.env.NODE_ENV': '"production"' },
})
await writeFile(resolve(dest, 'polyfills.js'), await readFile(resolve(root, 'android/provider-js/polyfills.js')))
await writeFile(resolve(dest, 'LICENSE-youtubei.txt'), await readFile(resolve(root, 'node_modules/youtubei.js/LICENSE')))
const notices=['Openfy para Android\n\n'+await readFile(resolve(root,'LICENSE'),'utf8')]
for(const name of ['youtubei.js','core-js','web-streams-polyfill','fast-text-encoding','meriyah','@bufbuild/protobuf','fflate']) {
  const dir=resolve(root,'node_modules',name)
  const metadata=JSON.parse(await readFile(resolve(dir,'package.json'),'utf8'))
  let license=''
  for(const file of ['LICENSE','LICENSE.txt','LICENSE.md','license','LICENSE-MIT']) {
    try { license=await readFile(resolve(dir,file),'utf8'); break } catch {}
  }
  if(name==='@bufbuild/protobuf') license=await readFile(resolve(root,'android/third-party/protobuf-es-LICENSE.txt'),'utf8')+'\n\n'+(await readFile(resolve(dir,'dist/esm/wire/varint.js'),'utf8')).split('/**',1)[0]
  if(!license) throw new Error(`Missing bundled license for ${name}`)
  notices.push(`${name} ${metadata.version}\n${metadata.homepage || metadata.repository?.url || ''}\n\n${license}`)
}
for(const name of ['quickjs-kt-LICENSE.txt','quickjs-LICENSE.txt']) notices.push(await readFile(resolve(root,'android/third-party',name),'utf8'))
notices.push('AndroidX / Media3 / Compose / Room / WorkManager / DataStore: https://android.googlesource.com/platform/frameworks/support/\nKotlin / kotlinx.coroutines / kotlinx.serialization: https://github.com/JetBrains/kotlin\nOkHttp: https://github.com/square/okhttp\nCoil: https://github.com/coil-kt/coil\nThese components are distributed under Apache License 2.0, reproduced above in the QuickJS-KT license. Their copyright notices and license metadata are also supplied by their published artifacts.')
await writeFile(resolve(dest,'NOTICE.txt'),notices.join('\n\n'+'='.repeat(64)+'\n\n'))
console.log('Android provider bundled (YouTube.js + existing Openfy catalog adapter).')
