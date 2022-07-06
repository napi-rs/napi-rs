import { join } from 'path'

import chalk from 'chalk'
import { Command, Option } from 'clipanion'
import inquirer from 'inquirer'
import { load, dump } from 'js-yaml'

import { debugFactory } from './debug'
import { spawn } from './spawn'
import { readFileAsync, writeFileAsync } from './utils'

const debug = debugFactory('rename')

export class RenameCommand extends Command {
  static paths = [['rename']]

  name = Option.String('-n', {
    required: false,
    description: 'The new name of the project',
  })

  napiName = Option.String('--napi-name', {
    required: false,
    description: 'The new napi addon name',
  })

  repository = Option.String('--repository', {
    required: false,
    description: 'The repository of the package',
  })

  description = Option.String('-d,--description', {
    required: false,
    description: 'The description of the package',
  })

  cwd = Option.String({
    required: false,
    description: 'The working directory, default is [process.cwd()]',
  })

  async execute() {
    const cwd = this.cwd ?? process.cwd()
    const packageJson = await readFileAsync(join(cwd, 'package.json'), 'utf8')
    const packageJsonData = JSON.parse(packageJson)
    const name =
      this.name ??
      (
        await inquirer.prompt({
          name: 'name',
          type: 'input',
          suffix: chalk.dim(' name field in package.json'),
        })
      ).name
    const napiName =
      this.napiName ??
      (
        await inquirer.prompt({
          name: 'napi name',
          type: 'input',
          default: name.split('/')[1],
        })
      )['napi name']
    debug('name: %s, napi name: %s', name, napiName)
    packageJsonData.name = name
    packageJsonData.napi.name = napiName
    const repository =
      this.repository ??
      (
        await inquirer.prompt({
          name: 'repository',
          type: 'input',
          suffix: chalk.dim(' Leave empty to skip'),
        })
      ).repository
    if (repository) {
      packageJsonData.repository = repository
    }
    const description =
      this.description ??
      (
        await inquirer.prompt({
          name: 'description',
          type: 'input',
          suffix: chalk.dim(' Leave empty to skip'),
        })
      ).description

    if (description) {
      packageJsonData.description = description
    }

    await writeFileAsync(
      join(cwd, 'package.json'),
      JSON.stringify(packageJsonData, null, 2),
    )

    const CI = await readFileAsync(
      join(cwd, '.github', 'workflows', 'CI.yml'),
      'utf8',
    )
    const CIObject = load(CI) as any
    CIObject.env.APP_NAME = napiName

    await writeFileAsync(
      join(cwd, '.github', 'workflows', 'CI.yml'),
      dump(CIObject, {
        lineWidth: 1000,
      }),
    )

    let tomlContent = await readFileAsync(join(cwd, 'Cargo.toml'), 'utf8')
    tomlContent = tomlContent.replace(
      'name = "napi-package-template"',
      `name = "${napiName}"`,
    )
    await writeFileAsync(join(cwd, 'Cargo.toml'), tomlContent)

    await spawn('napi create-npm-dir -t .')
  }
}
