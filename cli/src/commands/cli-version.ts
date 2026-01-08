import { Command } from 'clipanion'

import { CLI_VERSION } from '../utils/misc.js'

/**
 * A command that prints the version of the CLI.
 *
 * Paths: `-v`, `--version`
 */
export class CliVersionCommand extends Command<any> {
  static paths = [[`-v`], [`--version`]]
  async execute() {
    await this.context.stdout.write(`${CLI_VERSION}\n`)
  }
}
