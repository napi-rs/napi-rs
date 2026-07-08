import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const cliDir = fileURLToPath(new URL('../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

function resolveNpmCliFrom(directory) {
  for (const candidate of [
    join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(directory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]) {
    if (existsSync(candidate)) {
      return realpathSync(candidate)
    }
  }
}

function resolveNpmCli() {
  const bundledNpmCli = resolveNpmCliFrom(dirname(process.execPath))
  if (bundledNpmCli) {
    return bundledNpmCli
  }

  const npmLauncher = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  for (const pathEntry of (process.env.PATH ?? '').split(delimiter)) {
    if (!pathEntry) {
      continue
    }

    const launcherPath = join(pathEntry, npmLauncher)
    if (!existsSync(launcherPath)) {
      continue
    }

    const resolvedLauncherPath = realpathSync(launcherPath)
    if (resolvedLauncherPath.endsWith('npm-cli.js')) {
      return resolvedLauncherPath
    }

    const npmCli =
      resolveNpmCliFrom(dirname(resolvedLauncherPath)) ??
      resolveNpmCliFrom(dirname(launcherPath))
    if (npmCli) {
      return npmCli
    }
  }

  throw new Error(`Could not resolve ${npmLauncher} from PATH`)
}

async function runNpm(args, cwd) {
  return execFileAsync(process.execPath, [resolveNpmCli(), ...args], {
    cwd,
  })
}

export async function runPackedRawCliTest() {
  const testDir = await mkdtemp(join(tmpdir(), 'napi packed raw cli '))
  const packDir = join(testDir, 'packed artifact')
  const installDir = join(testDir, 'installed project')
  const projectDir = await mkdtemp(join(tmpdir(), 'napi raw cli '))
  const outputDir = join(projectDir, 'output artifacts')
  const npmDir = join(projectDir, 'npm packages')

  try {
    await Promise.all([
      mkdir(packDir),
      mkdir(installDir),
      mkdir(outputDir),
      mkdir(npmDir),
    ])
    await Promise.all([
      writeFile(
        join(installDir, 'package.json'),
        JSON.stringify({
          name: 'packed-raw-cli-test',
          private: true,
        }),
      ),
      writeFile(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'raw-cli-space-test',
          version: '1.0.0',
          napi: {
            binaryName: 'raw_cli_space_test',
            targets: [],
          },
        }),
      ),
    ])

    const { stdout } = await runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir],
      cliDir,
    )
    const packResult = JSON.parse(stdout)
    const tarballPath = join(packDir, packResult[0].filename)

    await runNpm(
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--omit=dev',
        tarballPath,
      ],
      installDir,
    )

    const rawCliPath = join(
      installDir,
      'node_modules',
      '@napi-rs',
      'cli',
      'cli.mjs',
    )
    await execFileAsync(
      process.execPath,
      [
        rawCliPath,
        'artifacts',
        '--cwd',
        projectDir,
        '--output-dir',
        outputDir,
        '--npm-dir',
        npmDir,
      ],
      {
        cwd: repositoryRoot,
      },
    )

    assert.ok(existsSync(outputDir))
    assert.ok(existsSync(npmDir))

    await execFileAsync(
      process.execPath,
      [
        rawCliPath,
        'rename',
        '--cwd',
        projectDir,
        '--package-name',
        '@scope/raw-cli-renamed',
      ],
      {
        cwd: repositoryRoot,
        timeout: 10_000,
      },
    )
    const renamedManifest = JSON.parse(
      await readFile(join(projectDir, 'package.json'), 'utf8'),
    )
    assert.equal(renamedManifest.napi.binaryName, 'raw_cli_space_test')
    assert.equal(renamedManifest.napi.packageName, '@scope/raw-cli-renamed')
  } finally {
    await Promise.all([
      rm(testDir, { force: true, recursive: true }),
      rm(projectDir, { force: true, recursive: true }),
    ])
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  await runPackedRawCliTest()
  process.stdout.write(`packed raw CLI passed on ${process.version}\n`)
}
