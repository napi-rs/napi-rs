import { prePublish } from '../api/pre-publish.js'
import { BasePrePublishCommand } from '../def/pre-publish.js'

export class PrePublishCommand extends BasePrePublishCommand {
  async execute() {
    // @ts-expect-error const 'npm' | 'lerna' to string
    await prePublish(this.getOptions())
  }
}
