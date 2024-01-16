import type {
  CommonPackageJsonFields,
  SupportedTestFramework,
} from '../../utils/config.js'
import { UNIVERSAL_TARGETS } from '../../utils/target.js'

export interface PackageMeta {
  'dist-tags': { [index: string]: string }
}

export const createPackageJson = async ({
  name,
  binaryName,
  targets,
  license,
  engineRequirement,
  cliVersion,
  testFramework,
}: {
  name: string
  binaryName: string
  targets: string[]
  license: string
  engineRequirement: string
  cliVersion: string
  testFramework: SupportedTestFramework
}) => {
  const hasWasmTarget = targets.some((t) => t.includes('wasm'))
  const universalTargets = targets.filter(
    (t) => t in UNIVERSAL_TARGETS,
  ) as (keyof typeof UNIVERSAL_TARGETS)[]
  const unifiedtargets = universalTargets.length
    ? targets.filter(
        (target) =>
          !universalTargets.some((t) => {
            // @ts-expect-error
            return UNIVERSAL_TARGETS[t].includes(target)
          }),
      )
    : targets
  const content: CommonPackageJsonFields = {
    name,
    version: '0.0.0',
    license,
    engines: {
      node: engineRequirement,
    },
    type: 'commonjs',
    main: 'index.js',
    types: 'index.d.ts',
    browser: 'browser.js',
    module: undefined,
    exports: undefined,
    napi: {
      binaryName,
      targets: unifiedtargets,
    },
    scripts: {
      test: testFramework,
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

  if (testFramework === 'ava') {
    const avaMeta = await fetch(`https://registry.npmjs.org/ava`).then(
      (res) => res.json() as Promise<PackageMeta>,
    )
    content.devDependencies!['ava'] = `^${avaMeta['dist-tags'].latest}`
    content.ava = {
      timeout: '1m',
    }
  }

  if (hasWasmTarget) {
    const wasmRuntime = await fetch(
      `https://registry.npmjs.org/@napi-rs/wasm-runtime`,
    ).then((res) => res.json() as Promise<PackageMeta>)
    const latest = wasmRuntime['dist-tags'].latest
    content.devDependencies!['@napi-rs/wasm-runtime'] = `^${latest}`
  }

  return JSON.stringify(content, null, 2)
}
