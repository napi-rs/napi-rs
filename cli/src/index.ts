import { Cli } from 'clipanion'

import { collectArtifacts } from './api/artifacts.js'
import { buildProject } from './api/build.js'
import { createNpmDirs } from './api/create-npm-dirs.js'
import { newProject } from './api/new.js'
import { prePublish } from './api/pre-publish.js'
import { renameProject } from './api/rename.js'
import { universalizeBinaries } from './api/universalize.js'
import { version } from './api/version.js'
import { ArtifactsCommand } from './commands/artifacts.js'
import { BuildCommand } from './commands/build.js'
import { CreateNpmDirsCommand } from './commands/create-npm-dirs.js'
import { HelpCommand } from './commands/help.js'
import { NewCommand } from './commands/new.js'
import { PrePublishCommand } from './commands/pre-publish.js'
import { RenameCommand } from './commands/rename.js'
import { UniversalizeCommand } from './commands/universalize.js'
import { VersionCommand } from './commands/version.js'
import { CLI_VERSION } from './utils/misc.js'

export const cli = new Cli({
  binaryName: 'napi',
  binaryVersion: CLI_VERSION,
})

cli.register(NewCommand)
cli.register(BuildCommand)
cli.register(CreateNpmDirsCommand)
cli.register(ArtifactsCommand)
cli.register(UniversalizeCommand)
cli.register(RenameCommand)
cli.register(PrePublishCommand)
cli.register(VersionCommand)
cli.register(HelpCommand)

/**
 *
 * @usage
 *
 * ```ts
 * const cli = new NapiCli()
 *
 * cli.build({
 *   cwd: '/path/to/your/project',
 * })
 * ```
 */
export class NapiCli {
  artifacts = collectArtifacts
  new = newProject
  build = buildProject
  createNpmDirs = createNpmDirs
  prePublish = prePublish
  rename = renameProject
  universalize = universalizeBinaries
  version = version
}

export { parseTriple } from './utils/target.js'
export {
  type GenerateTypeDefOptions,
  type WriteJsBindingOptions,
  writeJsBinding,
  generateTypeDef,
} from './api/build.js'
