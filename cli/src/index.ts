#!/usr/bin/env node

import { Cli } from 'clipanion'

import { ArtifactsCommand } from './artifacts'
import { BuildCommand } from './build'
import { CreateNpmDirCommand } from './create-npm-dir'
import { NewProjectCommand } from './new'
import { PrePublishCommand } from './pre-publish'
import { VersionCommand } from './version'

const cli = new Cli({
  binaryName: 'bin',
  binaryVersion: require('../package.json').version,
})

cli.register(ArtifactsCommand)
cli.register(BuildCommand)
cli.register(CreateNpmDirCommand)
cli.register(NewProjectCommand)
cli.register(PrePublishCommand)
cli.register(VersionCommand)

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
