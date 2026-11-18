import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const destination = resolve(process.argv[2], 'ThirdParty')
await mkdir(destination, { recursive: true })
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
const dependencies = []
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location.startsWith('node_modules/') || pkg.dev) continue
  const directory = resolve(location), name = pkg.name || location.split('node_modules/').at(-1)
  dependencies.push({ name, version: pkg.version, license: pkg.license || 'See upstream package' })
  try {
    const files = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice|third.party)/i.test(name))
    const target = join(destination, 'npm', `${name}@${pkg.version}`.replace(/[^\w@.-]/g, '_'))
    if (files.length) await mkdir(target, { recursive: true })
    for (const file of files) await copyFile(join(directory, file), join(target, file)).catch(() => {})
  } catch {}
}
await writeFile(join(destination, 'npm-dependencies.json'), JSON.stringify(dependencies, null, 2))
await copyFile('node_modules/ffmpeg-static/ffmpeg.exe.LICENSE', join(destination, 'FFmpeg-LICENSE.txt'))
await copyFile('desktop/licenses/Node-LICENSE.txt', join(destination, 'Node-LICENSE.txt'))
for (const file of await readdir('desktop/licenses')) await copyFile(join('desktop/licenses', file), join(destination, file))
await writeFile(join(destination, 'README.txt'), 'Openfy includes Node.js, .NET, Windows App SDK, Win2D, NAudio, Vortice, DiscordRichPresence, Newtonsoft.Json, FFmpeg and npm dependencies.\nNode: https://nodejs.org/\n.NET and Windows App SDK: https://github.com/dotnet/runtime and https://github.com/microsoft/WindowsAppSDK\nWin2D 1.4.0: https://github.com/microsoft/Win2D (MIT)\nNAudio: https://github.com/naudio/NAudio (MIT)\nVortice: https://github.com/amerkoleci/Vortice.Windows (MIT)\nDiscordRichPresence 1.6.1.70: https://github.com/Lachee/discord-rpc-csharp (MIT)\nNewtonsoft.Json 13.0.1: https://github.com/JamesNK/Newtonsoft.Json (MIT)\nFFmpeg binary and corresponding source: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1 and https://ffmpeg.org/releases/\nSee the accompanying license and notice files. No music is bundled.\n')
