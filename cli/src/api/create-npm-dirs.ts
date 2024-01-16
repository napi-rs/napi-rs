import { join, resolve } from 'node:path'

import { parse } from 'semver'

import {
  applyDefaultCreateNpmDirsOptions,
  CreateNpmDirsOptions,
} from '../def/create-npm-dirs.js'
import {
  debugFactory,
  readNapiConfig,
  mkdirAsync as rawMkdirAsync,
  pick,
  writeFileAsync as rawWriteFileAsync,
  Target,
} from '../utils/index.js'

import type { PackageMeta } from './templates/package.json.js'

const debug = debugFactory('create-npm-dirs')

export async function createNpmDirs(userOptions: CreateNpmDirsOptions) {
  const options = applyDefaultCreateNpmDirsOptions(userOptions)

  async function mkdirAsync(dir: string) {
    debug('Try to create dir: %i', dir)
    if (options.dryRun) {
      return
    }

    await rawMkdirAsync(dir, {
      recursive: true,
    })
  }

  async function writeFileAsync(file: string, content: string) {
    debug('Writing file %i', file)

    if (options.dryRun) {
      debug(content)
      return
    }

    await rawWriteFileAsync(file, content)
  }

  const packageJsonPath = resolve(options.cwd, options.packageJsonPath)
  const npmPath = resolve(options.cwd, options.npmDir)

  debug(`Read content from [${options.configPath ?? packageJsonPath}]`)

  const { targets, binaryName, packageName, packageJson } =
    await readNapiConfig(
      packageJsonPath,
      options.configPath ? resolve(options.cwd, options.configPath) : undefined,
    )

  for (const target of targets) {
    const targetDir = join(npmPath, `${target.platformArchABI}`)
    await mkdirAsync(targetDir)

    const binaryFileName =
      target.arch === 'wasm32'
        ? `${binaryName}.${target.platformArchABI}.wasm`
        : `${binaryName}.${target.platformArchABI}.node`
    const scopedPackageJson = {
      name: `${packageName}-${target.platformArchABI}`,
      version: packageJson.version,
      cpu: target.arch !== 'universal' ? [target.arch] : undefined,
      main: binaryFileName,
      files: [binaryFileName],
      ...pick(
        packageJson,
        'description',
        'keywords',
        'author',
        'authors',
        'homepage',
        'license',
        'engines',
        'publishConfig',
        'repository',
        'bugs',
      ),
    }
    if (target.arch !== 'wasm32') {
      // @ts-expect-error
      scopedPackageJson.os = [target.platform]
    } else {
      const entry = `${binaryName}.wasi.cjs`
      scopedPackageJson.main = entry
      // @ts-expect-error
      scopedPackageJson.browser = `${binaryName}.wasi-browser.js`
      scopedPackageJson.files.push(
        entry,
        // @ts-expect-error
        scopedPackageJson.browser,
        `wasi-worker.mjs`,
        `wasi-worker-browser.mjs`,
      )
      let needRestrictNodeVersion = true
      if (scopedPackageJson.engines?.node) {
        try {
          const { major } = parse(scopedPackageJson.engines.node) ?? {
            major: 0,
          }
          if (major >= 14) {
            needRestrictNodeVersion = false
          }
        } catch {
          // ignore
        }
      }
      if (needRestrictNodeVersion) {
        scopedPackageJson.engines = {
          node: '>=14.0.0',
        }
      }
      const wasmRuntime = await fetch(
        `https://registry.npmjs.org/@napi-rs/wasm-runtime`,
      ).then((res) => res.json() as Promise<PackageMeta>)
      // @ts-expect-error
      scopedPackageJson.dependencies = {
        '@napi-rs/wasm-runtime': `^${wasmRuntime['dist-tags'].latest}`,
      }
    }

    if (target.abi === 'gnu') {
      // @ts-expect-error
      scopedPackageJson.libc = ['glibc']
    } else if (target.abi === 'musl') {
      // @ts-expect-error
      scopedPackageJson.libc = ['musl']
    }

    const targetPackageJson = join(targetDir, 'package.json')
    await writeFileAsync(
      targetPackageJson,
      JSON.stringify(scopedPackageJson, null, 2),
    )
    const targetReadme = join(targetDir, 'README.md')
    await writeFileAsync(targetReadme, readme(packageName, target))

    debug.info(`${packageName} -${target.platformArchABI} created`)
  }
}

function readme(packageName: string, target: Target) {
  return `# \`${packageName}-${target.platformArchABI}\`

This is the **${target.triple}** binary for \`${packageName}\`
`
}
