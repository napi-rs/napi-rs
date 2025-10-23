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

export function createBuildCommand(args: string[]): BuildCommand {
  return cli.process(['build', ...args]) as BuildCommand
}

export function createArtifactsCommand(args: string[]): ArtifactsCommand {
  return cli.process(['artifacts', ...args]) as ArtifactsCommand
}

export function createCreateNpmDirsCommand(
  args: string[],
): CreateNpmDirsCommand {
  return cli.process(['create-npm-dirs', ...args]) as CreateNpmDirsCommand
}

export function createPrePublishCommand(args: string[]): PrePublishCommand {
  return cli.process(['pre-publish', ...args]) as PrePublishCommand
}

export function createRenameCommand(args: string[]): RenameCommand {
  return cli.process(['rename', ...args]) as RenameCommand
}

export function createUniversalizeCommand(args: string[]): UniversalizeCommand {
  return cli.process(['universalize', ...args]) as UniversalizeCommand
}

export function createVersionCommand(args: string[]): VersionCommand {
  return cli.process(['version', ...args]) as VersionCommand
}

export function createNewCommand(args: string[]): NewCommand {
  return cli.process(['new', ...args]) as NewCommand
}

export { parseTriple } from './utils/target.js'
export {
  type GenerateTypeDefOptions,
  type WriteJsBindingOptions,
  writeJsBinding,
  generateTypeDef,
} from './api/build.js'
export { readNapiConfig } from './utils/config.js'
