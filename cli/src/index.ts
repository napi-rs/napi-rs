import 'core-js/es/string/replace-all'

import { Cli } from 'clipanion'

import { version } from '../package.json'

import { ArtifactsCommand } from './artifacts'
import { BuildCommand } from './build'
import { CreateNpmDirCommand } from './create-npm-dir'
import { NewProjectCommand } from './new'
import { PrePublishCommand } from './pre-publish'
import { RenameCommand } from './rename'
import { VersionCommand } from './version'

const cli = new Cli({
  binaryName: 'napi',
  binaryVersion: version,
})

cli.register(ArtifactsCommand)
cli.register(BuildCommand)
cli.register(CreateNpmDirCommand)
cli.register(PrePublishCommand)
cli.register(VersionCommand)
cli.register(NewProjectCommand)
cli.register(RenameCommand)

cli
  .run(process.argv.slice(2), {
    ...Cli.defaultContext,
  })
  .then((status) => {
    process.exit(status)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
