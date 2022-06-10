import { version } from '../../package.json'
import { DefaultPlatforms } from '../parse-triple'

export const createPackageJson = (
  name: string,
  binaryName: string,
  targets: string[],
) => {
  const pkgContent = {
    name,
    version: '0.0.0',
    main: 'index.js',
    types: 'index.d.ts',
    napi: {
      name: binaryName,
    },
    license: 'MIT',
    devDependencies: {
      '@napi-rs/cli': `^${version}`,
      ava: '^4.3.0',
    },
    engines: {
      node: '>= 10',
    },
    scripts: {
      artifacts: 'napi artifacts',
      build: 'napi build --platform --release',
      'build:debug': 'napi build --platform',
      prepublishOnly: 'napi prepublish -t npm',
      test: 'ava',
      version: 'napi version',
    },
  }

  const triples: any = {}

  const defaultTargetsSupported = DefaultPlatforms.every((p) =>
    targets!.includes(p.raw),
  )

  const isOnlyDefaultTargets =
    targets.length === 3 &&
    DefaultPlatforms.every((p) => targets.includes(p.raw))

  if (!isOnlyDefaultTargets) {
    if (!defaultTargetsSupported) {
      triples.defaults = false
      triples.additional = targets
    } else {
      triples.additional = targets.filter(
        (t) => !DefaultPlatforms.map((p) => p.raw).includes(t),
      )
    }
  }

  // @ts-expect-error
  pkgContent.napi.triples = triples

  return pkgContent
}
