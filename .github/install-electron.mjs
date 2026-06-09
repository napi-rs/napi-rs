// Robust replacement for `node ./node_modules/electron/install.js`.
//
// electron's own install.js extracts the downloaded archive with
// extract-zip/yauzl, whose streaming inflate stalls mid-archive on Node >=24.16
// and >=26 (an upstream Node Readable scheduling regression). When that happens
// install.js silently exits 0 without writing `path.txt`, and the Electron test
// later fails with a confusing `ENOENT path.txt`.
//
// We keep using @electron/get to download the archive (fetch-based, unaffected),
// but extract it with the OS unzip / Expand-Archive so it works on every Node
// version. This changes nothing about the test or its assertions.
import { downloadArtifact } from '@electron/get'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))
const { version } = require('electron/package.json')

const platformPath =
  process.platform === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron'
    : process.platform === 'win32'
      ? 'electron.exe'
      : 'electron'

const zipPath = await downloadArtifact({
  version,
  artifactName: 'electron',
  force: process.env.force_no_cache === 'true',
  cacheRoot: process.env.electron_config_cache,
  checksums: require('electron/checksums.json'),
})

const dist = join(electronDir, 'dist')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -Force -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(dist)}`,
    ],
    { stdio: 'inherit' },
  )
} else {
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', dist], { stdio: 'inherit' })
}

writeFileSync(join(electronDir, 'path.txt'), platformPath)
console.log(`Electron ${version} installed to ${join(dist, platformPath)}`)
