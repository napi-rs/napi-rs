import { renameProject } from '../api/rename.js'
import { BaseRenameCommand } from '../def/rename.js'

export class RenameCommand extends BaseRenameCommand {
  async execute() {
    await renameProject(this.getOptions())
  }
}
