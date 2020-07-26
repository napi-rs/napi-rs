import { Cli } from 'clipanion'

import { BuildCommand } from './build'

const cli = new Cli({
  binaryName: 'bin',
  binaryVersion: require('../package.json').version,
})

cli.register(BuildCommand)

cli
  .run(process.argv.slice(2), {
    ...Cli.defaultContext,
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
