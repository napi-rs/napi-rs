import { Command } from 'clipanion'

/**
 * A command that prints the usage of all commands.
 *
 * Paths: `-h`, `--help`
 */
export class HelpCommand extends Command<any> {
  static paths = [[`-h`], [`--help`]]
  async execute() {
    await this.context.stdout.write(this.cli.usage())
  }
}
