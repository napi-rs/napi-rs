import { input } from '@inquirer/prompts'

import { renameProject } from '../api/rename.js'
import { BaseRenameCommand } from '../def/rename.js'

export class RenameCommand extends BaseRenameCommand {
  async execute() {
    const options = this.getOptions()
    const hasExplicitRename = [
      options.name,
      options.binaryName,
      options.packageName,
      options.repository,
      options.description,
    ].some((value) => value !== undefined)
    if (!hasExplicitRename) {
      const name = await input({
        message: `Enter the new package name in the package.json`,
        required: true,
      })
      options.name = name
      const binaryName = await input({
        message: `Enter the new binary name`,
        required: true,
      })
      options.binaryName = binaryName
    }
    await renameProject(options)
  }
}
