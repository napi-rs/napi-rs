#!/usr/bin/env node

import { Cli } from 'clipanion'

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

const cli = new Cli({
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

void cli.runExit(process.argv.slice(2))
