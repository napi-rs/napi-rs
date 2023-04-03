import { join, resolve } from 'path'

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

  debug(`Read content from [${packageJsonPath}]`)

  const { targets, binaryName, packageName, packageJson } =
    await readNapiConfig(packageJsonPath)

  for (const target of targets) {
    const targetDir = join(npmPath, `${target.platformArchABI}`)
    await mkdirAsync(targetDir)

    const binaryFileName = `${binaryName}.${target.platformArchABI}.node`
    const scopedPackageJson = {
      name: `${packageName}-${target.platformArchABI}`,
      version: packageJson.version,
      os: [target.platform],
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

    // Only works with yarn 3.1+
    // https://github.com/yarnpkg/berry/pull/3981
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

    debug.info(`${packageName}-${target.platformArchABI} created`)
  }
}

function readme(packageName: string, target: Target) {
  return `# \`${packageName}-${target.platformArchABI}\`

This is the **${target.triple}** binary for \`${packageName}\`
`
}
