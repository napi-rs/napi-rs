import { CommonPackageJsonFields } from '../../utils/config.js'

export const createPackageJson = ({
  name,
  binaryName,
  targets,
  license,
  engineRequirement,
  cliVersion,
  esm,
}: {
  name: string
  binaryName: string
  targets: string[]
  license: string
  engineRequirement: string
  cliVersion: string
  esm: boolean
}) => {
  const content: CommonPackageJsonFields = {
    name,
    version: '1.0.0',
    license,
    engines: {
      node: engineRequirement,
    },
    type: 'commonjs',
    main: 'index.js',
    types: 'index.d.ts',
    module: undefined,
    exports: undefined,
    napi: {
      binaryName,
      targets,
    },
    scripts: {
      test: 'node -e "assert(require(\'.\').sum(1, 2) === 3)"',
      build: 'napi build --release --platform --strip',
      'build:debug': 'napi build',
      prepublishOnly: 'napi prepublish -t npm',
      artifacts: 'napi artifacts',
      version: 'napi version',
    },
    devDependencies: {
      '@napi-rs/cli': `^${cliVersion}`,
    },
  }

  if (esm) {
    content.type = 'module'
    content.main = 'index.cjs'
    content.module = 'index.js'
    content.exports = {
      '.': {
        import: {
          default: './index.js',
          types: './index.d.ts',
        },
        require: {
          default: './index.cjs',
          types: './index.d.ts',
        },
      },
    }
  }

  return JSON.stringify(content, null, 2)
}
