import { execSync } from 'node:child_process'

import { Option } from 'clipanion'

import { buildProject } from '../api/build.js'
import { BaseBuildCommand } from '../def/build.js'
import { debugFactory } from '../utils/index.js'

const debug = debugFactory('build')

export class BuildCommand extends BaseBuildCommand {
  pipe = Option.String('--pipe', {
    description:
      'Pipe all outputs file to given command. e.g. `napi build --pipe "npx prettier --write"`',
  })

  cargoOptions = Option.Rest()

  async execute() {
    const { task } = await buildProject({
      ...this.getOptions(),
      cargoOptions: this.cargoOptions,
    })

    const outputs = await task

    if (this.pipe) {
      for (const output of outputs) {
        debug('Piping output file to command: %s', this.pipe)
        try {
          execSync(`${this.pipe} ${output.path}`, {
            stdio: 'inherit',
            cwd: this.cwd,
          })
        } catch (e) {
          debug.error(`Failed to pipe output file ${output.path} to command`)
          debug.error(e)
        }
      }
    }
  }
}
