import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  applyDefaultTypegenOptions,
  type TypegenOptions,
} from '../def/typegen.js'
import {
  type NapiConfig,
  readNapiConfig,
  debugFactory,
  readFileAsync,
  processTypeDefContent,
  DEFAULT_TYPE_DEF_HEADER,
} from '../utils/index.js'

const debug = debugFactory('typegen')

interface NativeTypegen {
  generate: (opts: {
    crateDir: string
    strict?: boolean
  }) => { typeDefs: string[]; parseErrors: number }
}

let nativeTypegen: NativeTypegen | null = null

try {
  const require = createRequire(import.meta.url)
  nativeTypegen = require('@napi-rs/typegen')
} catch {
  debug('Native @napi-rs/typegen not available, falling back to binary')
}

function runBinary(
  binary: string,
  crateDir: string,
  strict: boolean,
  cwd: string,
): string {
  const args = ['--crate-dir', crateDir]
  if (strict) {
    args.push('--strict')
  }

  debug('Running: %s %s', binary, args.join(' '))

  const result = spawnSync(binary, args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (result.error) {
    throw new Error(
      `napi-typegen failed. Is it installed?\n` +
        `Install with: npm install -D @napi-rs/typegen\n` +
        `Or with Cargo: cargo install napi-typegen\n` +
        `Or specify path: napi typegen --napi-typegen /path/to/napi-typegen\n\n` +
        `error: ${result.error.message}`,
    )
  }

  // Log stderr warnings (e.g. "N items failed to convert") even on success
  if (result.stderr) {
    debug('napi-typegen stderr:\n%s', result.stderr)
  }

  if (result.status !== 0) {
    throw new Error(
      `napi-typegen exited with status ${result.status}.\n\n` +
        `stderr: ${result.stderr ?? ''}`,
    )
  }

  return result.stdout
}

export async function typegenProject(
  userOptions: TypegenOptions,
): Promise<string> {
  const options = applyDefaultTypegenOptions(userOptions)
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd()
  const crateDir = options.crateDir ? resolve(cwd, options.crateDir) : cwd
  const outputDir = options.outputDir ? resolve(cwd, options.outputDir) : crateDir

  // Attempt to load project config (package.json#napi or separate config file)
  const packageJsonPath = resolve(cwd, options.packageJsonPath ?? 'package.json')
  let config: NapiConfig | null = null
  try {
    config = await readNapiConfig(
      packageJsonPath,
      options.configPath ? resolve(cwd, options.configPath) : undefined,
    )
  } catch {
    debug('No project config found, using defaults')
  }

  let jsonlOutput: string

  if (options.napiTypegen) {
    // Explicit binary path — highest priority override
    jsonlOutput = runBinary(options.napiTypegen, crateDir, options.strict, cwd)
  } else if (nativeTypegen) {
    // Native addon — preferred when no explicit path is given
    debug('Using native @napi-rs/typegen addon')
    const result = nativeTypegen.generate({
      crateDir,
      strict: options.strict,
    })
    jsonlOutput = result.typeDefs.join('\n')
  } else {
    // Fallback to binary in PATH
    jsonlOutput = runBinary('napi-typegen', crateDir, options.strict, cwd)
  }

  // Process the JSONL content directly (no temp file needed)
  const constEnum = options.constEnum ?? config?.constEnum ?? true
  const { dts: typeDefs } = processTypeDefContent(jsonlOutput, constEnum)

  // Assemble header + special types + type defs (matching build.ts logic)
  let header = ''
  if (!options.noDtsHeader) {
    if (config?.dtsHeaderFile) {
      try {
        header = await readFileAsync(
          join(cwd, config.dtsHeaderFile),
          'utf-8',
        )
      } catch (e) {
        debug.warn(
          `Failed to read dts header file ${config.dtsHeaderFile}`,
          e,
        )
      }
    } else if (options.dtsHeader ?? config?.dtsHeader) {
      header = (options.dtsHeader ?? config?.dtsHeader)!
    } else {
      header = DEFAULT_TYPE_DEF_HEADER
    }
  }

  if (typeDefs.indexOf('ExternalObject<') > -1) {
    header += `
export declare class ExternalObject<T> {
  readonly '': {
    readonly '': unique symbol
    [K: symbol]: T
  }
}
`
  }

  if (typeDefs.indexOf('TypedArray') > -1) {
    header += `
export type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array
`
  }

  const dts = header + typeDefs

  mkdirSync(outputDir, { recursive: true })
  const dtsFile = join(outputDir, options.dts)
  await writeFile(dtsFile, dts, 'utf-8')

  debug('Generated type definitions to %s', dtsFile)

  return dtsFile
}
