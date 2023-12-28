import { Command } from 'clipanion'

import { collectArtifacts } from '../api/artifacts.js'
import { BaseArtifactsCommand } from '../def/artifacts.js'

export class ArtifactsCommand extends BaseArtifactsCommand {
  static usage = Command.Usage({
    description: 'Copy artifacts from Github Actions into specified dir',
    examples: [
      [
        '$0 artifacts --output-dir ./artifacts --dist ./npm',
        `Copy [binaryName].[platform].node under current dir(.) into packages under npm dir.
e.g: index.linux-x64-gnu.node --> ./npm/linux-x64-gnu/index.linux-x64-gnu.node`,
      ],
    ],
  })

  static paths = [['artifacts']]

  async execute() {
    await collectArtifacts(this.getOptions())
  }
}
