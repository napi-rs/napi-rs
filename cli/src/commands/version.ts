import { version } from '../api/version.js'
import { BaseVersionCommand } from '../def/version.js'

export class VersionCommand extends BaseVersionCommand {
  async execute() {
    await version(this.getOptions())
  }
}
