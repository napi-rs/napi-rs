import path from 'node:path'

import { input, select, checkbox, confirm } from '@inquirer/prompts'
import { Option } from 'clipanion'

import { newProject } from '../api/new.js'
import { BaseNewCommand } from '../def/new.js'
import {
  AVAILABLE_TARGETS,
  debugFactory,
  DEFAULT_TARGETS,
  type TargetTriple,
} from '../utils/index.js'
import { napiEngineRequirement } from '../utils/version.js'

const debug = debugFactory('new')

export class NewCommand extends BaseNewCommand {
  interactive = Option.Boolean('--interactive,-i', true, {
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
      const targetPath: string = cmdOptions.path
        ? cmdOptions.path
        : await inquirerProjectPath()
      cmdOptions.path = targetPath
      return {
        ...cmdOptions,
        name: await this.fetchName(path.parse(targetPath).base),
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
      input({
        message: 'Package name (the name field in your package.json file)',
        default: defaultName,
      })
    )
  }

  private async fetchLicense(): Promise<string> {
    return input({
      message: 'License for open-sourced project',
      default: this.license,
    })
  }

  private async fetchNapiVersion(): Promise<number> {
    return select({
      message: 'Minimum node-api version (with node version requirement)',
      loop: false,
      pageSize: 10,
      choices: Array.from({ length: 8 }, (_, i) => ({
        name: `napi${i + 1} (${napiEngineRequirement(i + 1)})`,
        value: i + 1,
      })),
      // choice index
      default: this.minNodeApiVersion - 1,
    })
  }

  private async fetchTargets(): Promise<TargetTriple[]> {
    if (this.enableAllTargets) {
      return AVAILABLE_TARGETS.concat()
    }

    const targets = await checkbox({
      loop: false,
      message: 'Choose target(s) your crate will be compiled to',
      choices: AVAILABLE_TARGETS.map((target) => ({
        name: target,
        value: target,
        // @ts-expect-error
        checked: DEFAULT_TARGETS.includes(target),
      })),
    })

    return targets
  }

  private async fetchTypeDef(): Promise<boolean> {
    const enableTypeDef = await confirm({
      message: 'Enable type definition auto-generation',
      default: this.enableTypeDef,
    })

    return enableTypeDef
  }

  private async fetchGithubActions(): Promise<boolean> {
    const enableGithubActions = await confirm({
      message: 'Enable Github Actions CI',
      default: this.enableGithubActions,
    })

    return enableGithubActions
  }
}

async function inquirerProjectPath(): Promise<string> {
  return input({
    message: 'Target path to create the project, relative to cwd.',
  }).then((path) => {
    if (!path) {
      return inquirerProjectPath()
    }
    return path
  })
}
