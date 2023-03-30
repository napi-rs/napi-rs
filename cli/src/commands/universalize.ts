import { universalizeBinaries } from '../api/universalize.js'
import { BaseUniversalizeCommand } from '../def/universalize.js'

export class UniversalizeCommand extends BaseUniversalizeCommand {
  async execute() {
    await universalizeBinaries(this.getOptions())
  }
}
