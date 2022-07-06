import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

import chalk from 'chalk'
import { Command, Option } from 'clipanion'
import inquirer from 'inquirer'

import { CreateNpmDirCommand } from '../create-npm-dir'
import { debugFactory } from '../debug'
import { DefaultPlatforms } from '../parse-triple'
import { spawn } from '../spawn'

import { GitIgnore } from './.gitignore-template'
import { createCargoContent } from './cargo'
import { createCargoConfig } from './cargo-config'
import { createGithubActionsCIYml } from './ci-yml'
import { LibRs } from './lib-rs'
import { NPMIgnoreFiles } from './npmignore'
import { createPackageJson } from './package'

const NAME_PROMOTE_NAME = 'Package name'
const DIR_PROMOTE_NAME = 'Dir name'
const ENABLE_GITHUB_ACTIONS_PROMOTE_NAME = 'Enable github actions'

const debug = debugFactory('create')

const BUILD_RS = `extern crate napi_build;

fn main() {
  napi_build::setup();
}
`

const SupportedPlatforms: string[] = [
  'aarch64-apple-darwin',
  'aarch64-linux-android',
  'aarch64-unknown-linux-gnu',
  'aarch64-unknown-linux-musl',
  'aarch64-pc-windows-msvc',
  'armv7-unknown-linux-gnueabihf',
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
  'x86_64-unknown-linux-musl',
  'x86_64-unknown-freebsd',
  'i686-pc-windows-msvc',
  'armv7-linux-androideabi',
]

export class NewProjectCommand extends Command {
  static usage = Command.Usage({
    description: 'Create a new project from scratch',
  })

  static paths = [['new']]

  name?: string = Option.String({
    name: '-n,--name',
    required: false,
  })

  dirname?: string = Option.String({
    name: '-d,--dirname',
    required: false,
  })

  targets?: string[] = Option.Array('--targets,-t')

  dryRun = Option.Boolean(`--dry-run`, false)

  enableGithubActions?: boolean = Option.Boolean(`--enable-github-actions`)

  async execute() {
    await this.getName()
    if (!this.dirname) {
      const [scope, name] = this.name?.split('/') ?? []
      const defaultProjectDir = name ?? scope
      const dirAnswer = await inquirer.prompt({
        type: 'input',
        name: DIR_PROMOTE_NAME,
        default: defaultProjectDir,
      })

      this.dirname = dirAnswer[DIR_PROMOTE_NAME]
    }

    if (!this.targets) {
      const { targets } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'targets',
          message: 'Choose targets you want to support',
          default: DefaultPlatforms.map((p) => p.raw),
          choices: SupportedPlatforms,
        },
      ])

      if (!targets.length) {
        throw new TypeError('At least choose one target')
      }

      this.targets = targets
    }

    if (this.enableGithubActions === undefined) {
      const answer = await inquirer.prompt([
        {
          type: 'confirm',
          name: ENABLE_GITHUB_ACTIONS_PROMOTE_NAME,
          message: 'Enable github actions?',
          default: true,
          choices: SupportedPlatforms,
        },
      ])
      this.enableGithubActions = answer[ENABLE_GITHUB_ACTIONS_PROMOTE_NAME]
    }

    debug(`Running command: ${chalk.green('[${command}]')}`)
    if (!this.dryRun) {
      mkdirSync(join(process.cwd(), this.dirname!), {
        recursive: true,
      })
      mkdirSync(join(process.cwd(), this.dirname!, 'src'), {
        recursive: true,
      })
    }

    const [s, pkgName] = this.name!.split('/')
    const binaryName = pkgName ?? s

    this.writeFile('Cargo.toml', createCargoContent(this.name!))
    this.writeFile('.npmignore', NPMIgnoreFiles)
    this.writeFile('build.rs', BUILD_RS)
    this.writeFile(
      'package.json',
      JSON.stringify(
        createPackageJson(this.name!, binaryName, this.targets!),
        null,
        2,
      ),
    )
    this.writeFile('src/lib.rs', LibRs)

    mkdirSync(join(process.cwd(), this.dirname!, '__test__'), {
      recursive: true,
    })
    this.writeFile(
      '__test__/index.spec.mjs',
      `import test from 'ava'

import { sum } from '../index.js'

test('sum from native', (t) => {
  t.is(sum(1, 2), 3)
})
`,
    )

    if (this.enableGithubActions) {
      const githubDir = join(process.cwd(), this.dirname!, '.github')
      const workflowsDir = join(githubDir, 'workflows')
      if (!this.dryRun) {
        mkdirSync(githubDir, { recursive: true })
        mkdirSync(workflowsDir, { recursive: true })
      }
      this.writeFile(
        join('.github', 'workflows', 'CI.yml'),
        createGithubActionsCIYml(binaryName, this.targets!),
      )
    }

    await CreateNpmDirCommand.create(
      'package.json',
      join(process.cwd(), this.dirname!),
      join(process.cwd(), this.dirname!),
    )

    const enableLinuxArm8Gnu = this.targets!.includes(
      'aarch64-unknown-linux-gnu',
    )
    const enableLinuxArm8Musl = this.targets!.includes(
      'aarch64-unknown-linux-musl',
    )
    const enableLinuxArm7 = this.targets!.includes(
      'armv7-unknown-linux-gnueabihf',
    )
    const cargoConfig = createCargoConfig(
      enableLinuxArm7,
      enableLinuxArm8Gnu,
      enableLinuxArm8Musl,
    )
    if (cargoConfig.length) {
      const configDir = join(process.cwd(), this.dirname!, '.cargo')
      if (!this.dryRun) {
        mkdirSync(configDir, { recursive: true })
        this.writeFile(join('.cargo', 'config.toml'), cargoConfig)
      }
    }
    this.writeFile(
      'rustfmt.toml',
      `tab_spaces = 2
edition = "2021"
`,
    )
    this.writeFile('.gitignore', GitIgnore)
    this.writeFile('.yarnrc.yml', 'nodeLinker: node-modules')
    await spawn(`yarn set version stable`, {
      cwd: join(process.cwd(), this.dirname!),
    })
    await spawn(`yarn install`, {
      cwd: join(process.cwd(), this.dirname!),
    })
  }

  private writeFile(path: string, content: string) {
    const distDir = join(process.cwd(), this.dirname!)
    this.context.stdout.write(chalk.green(`Writing ${chalk.blue(path)}\n`))
    if (!this.dryRun) {
      writeFileSync(join(distDir, path), content)
    }
  }

  private async getName() {
    if (!this.name) {
      const nameAnswer = await inquirer.prompt({
        type: 'input',
        name: NAME_PROMOTE_NAME,
        suffix: ' (The name filed in your package.json)',
      })

      const name = nameAnswer[NAME_PROMOTE_NAME]
      if (!name) {
        await this.getName()
      } else {
        this.name = name
      }
    }
  }
}
