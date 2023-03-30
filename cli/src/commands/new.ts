import path from 'path'

import { Option } from 'clipanion'
import inquirer from 'inquirer'

import { newProject } from '../api/new.js'
import { BaseNewCommand } from '../def/new.js'
import {
  AVAILABLE_TARGETS,
  debugFactory,
  DEFAULT_TARGETS,
  TargetTriple,
} from '../utils/index.js'
import { napiEngineRequirement } from '../utils/version.js'

const debug = debugFactory('new')

export class NewCommand extends BaseNewCommand {
  interactive = Option.Boolean('--interactive,-i', false, {
    description:
      'Ask project basic information interactively without just using the default.',
  })

  async execute() {
    try {
      const options = await this.fetchOptions()
      await newProject(options)
      return 0
    } catch (e) {
      debug('Failed to create new project')
      debug.error(e)
      return 1
    }
  }

  private async fetchOptions() {
    const cmdOptions = super.getOptions()

    if (this.interactive) {
      return {
        ...cmdOptions,
        name: await this.fetchName(path.parse(cmdOptions.path).base),
        minNodeApiVersion: await this.fetchNapiVersion(),
        targets: await this.fetchTargets(),
        license: await this.fetchLicense(),
        enableTypeDef: await this.fetchTypeDef(),
        enableGithubActions: await this.fetchGithubActions(),
      }
    }

    return cmdOptions
  }

  private async fetchName(defaultName: string): Promise<string> {
    return (
      this.$$name ??
      (await inquirer
        .prompt({
          type: 'input',
          name: 'name',
          message: 'Package name (the name field in your package.json file)',
          default: defaultName,
        })
        .then(({ name }) => name))
    )
  }

  private async fetchLicense(): Promise<string> {
    return inquirer
      .prompt({
        type: 'input',
        name: 'license',
        message: 'License for open-sourced project',
        default: this.license,
      })
      .then(({ license }) => license)
  }

  private async fetchNapiVersion(): Promise<number> {
    return inquirer
      .prompt({
        type: 'list',
        name: 'minNodeApiVersion',
        message: 'Minimum node-api version (with node version requirement)',
        loop: false,
        choices: new Array(8).fill(0).map((_, i) => ({
          name: `napi${i + 1} (${napiEngineRequirement(i + 1)})`,
          value: i + 1,
        })),
        // choice index
        default: this.minNodeApiVersion - 1,
      })
      .then(({ minNodeApiVersion }) => minNodeApiVersion)
  }

  private async fetchTargets(): Promise<TargetTriple[]> {
    if (this.enableDefaultTargets) {
      return DEFAULT_TARGETS.concat()
    }

    if (this.enableAllTargets) {
      return AVAILABLE_TARGETS.concat()
    }

    const { targets } = await inquirer.prompt({
      name: 'targets',
      type: 'checkbox',
      loop: false,
      message: 'Choose target(s) your crate will be compiled to',
      default: DEFAULT_TARGETS,
      choices: AVAILABLE_TARGETS,
    })

    return targets
  }

  private async fetchTypeDef(): Promise<boolean> {
    const { enableTypeDef } = await inquirer.prompt({
      name: 'enableTypeDef',
      type: 'confirm',
      message: 'Enable type definition auto-generation',
      default: this.enableTypeDef,
    })

    return enableTypeDef
  }

  private async fetchGithubActions(): Promise<boolean> {
    const { enableGithubActions } = await inquirer.prompt({
      name: 'enableGithubActions',
      type: 'confirm',
      message: 'Enable Github Actions CI',
      default: this.enableGithubActions,
    })

    return enableGithubActions
  }
}
