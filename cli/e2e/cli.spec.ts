import { exec, type ExecOptions } from 'node:child_process'
import { join } from 'node:path'
// use posix path to prevent `\` on Windows
import { join as posixJoin } from 'node:path/posix'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

import ava, { type TestFn } from 'ava'

import packageJson from '../package.json' with { type: 'json' }
import { fileURLToPath } from 'node:url'

const test = ava as TestFn<{
  context: string
}>

const rootDir = join(fileURLToPath(import.meta.url), '..', '..', '..')
const rootDirPosix = posixJoin(
  fileURLToPath(import.meta.url, {
    windows: false,
  }),
  '..',
  '..',
  '..',
)

/**
 * The hooks below `npm install` the packed CLI and the tests run real cargo
 * builds. On the Windows runners a single step takes minutes while nothing
 * completes, which trips ava's global 5-minute *inactivity* timer. Bounding
 * each step with `t.timeout` mutes that timer for the given period (ava emits
 * `test-timeout-configured`, which the runner's timeout trigger ignores for),
 * so a slow-but-progressing step no longer fails the whole file.
 */
const E2E_STEP_TIMEOUT = 15 * 60 * 1000

test.before(async (t) => {
  t.timeout(E2E_STEP_TIMEOUT)
  await execAsync(`yarn workspace @napi-rs/cli build`, {
    cwd: rootDir,
  })
  await execAsync(`npm pack`, {
    cwd: join(rootDir, 'cli'),
  })
})

test.beforeEach(async (t) => {
  t.timeout(E2E_STEP_TIMEOUT)
  const random = Math.random().toString(36).slice(2)
  t.context.context = join(tmpdir(), 'napi-rs-cli-e2e', random)
  await mkdir(t.context.context, { recursive: true })
  await writePackageJson(t.context.context, {})
  await execAsync(`npm install`, {
    cwd: t.context.context,
  })
})

test.afterEach(async (t) => {
  t.timeout(E2E_STEP_TIMEOUT)
  await rm(t.context.context, { recursive: true, force: true })
})

test('should print help', async (t) => {
  t.timeout(E2E_STEP_TIMEOUT)
  const bin = join(t.context.context, 'node_modules', '.bin')
  await execAsync(`${bin}/napi --help`)
  await execAsync(`${bin}/napi build --help`)
  await execAsync(`${bin}/napi version --help`)
  await execAsync(`${bin}/napi pre-publish --help`)
  await execAsync(`${bin}/napi create-npm-dirs --help`)
  await execAsync(`${bin}/napi new --help`)
  await execAsync(`${bin}/napi rename --help`)
  await execAsync(`${bin}/napi version --help`)
  t.pass()
})

test('should be able to build a project', async (t) => {
  t.timeout(E2E_STEP_TIMEOUT)
  const { context } = t.context
  await writeCargoToml(context)
  await writePackageJson(context, {})
  const bin = join(context, 'node_modules', '.bin')
  await execAsync(`${bin}/napi build`, {
    cwd: context,
    env: {
      ...process.env,
      DEBUG: 'napi:*',
    },
  })
  t.truthy(existsSync(join(context, 'index.node')))
})

test('should exit non-zero when pipe command fails', async (t) => {
  t.timeout(E2E_STEP_TIMEOUT)
  const { context } = t.context
  await writeCargoToml(context)
  await writePackageJson(context, {})
  await writeFile(join(context, 'postprocess-fail.cjs'), 'process.exit(1)\n')

  const bin = join(context, 'node_modules', '.bin')
  const { code, stderr } = await execResult(
    `${bin}/napi build --pipe "node ./postprocess-fail.cjs"`,
    {
      cwd: context,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    },
  )

  t.true(Number.isInteger(code) && code !== 0)
  t.regex(stderr, /Failed to pipe output file/)
})

test('should throw error when duplicate targets are provided', async (t) => {
  t.timeout(E2E_STEP_TIMEOUT)
  const { context } = t.context
  await writeCargoToml(context)
  await writePackageJson(context, {
    napi: {
      targets: ['aarch64-apple-darwin', 'aarch64-apple-darwin'],
    },
  })
  const bin = join(context, 'node_modules', '.bin')
  let errMsg = ''
  const cp = exec(
    `${bin}/napi build`,
    {
      encoding: 'utf8',
      cwd: context,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    },
    (_, stdout) => {
      errMsg += stdout
    },
  )
  await new Promise<void>((resolve) => {
    cp.on('close', () => {
      resolve()
    })
  })
  t.truthy(
    errMsg
      .trim()
      .startsWith(
        'Internal Error: Duplicate targets are not allowed: aarch64-apple-darwin',
      ),
  )
})

/**
 * The generated loaders own `__napiBindingTarget`, so an addon export of that
 * name is rejected — but only for builds that emit a loader. A crate exporting
 * the name stays buildable as a plain `.node` addon, exactly as it was before
 * the export existed.
 */
const BINDING_TARGET_LIB_RS = `use napi_derive::napi;

#[napi]
pub fn sum(a: u32, b: u32) -> u32 {
  a + b
}

#[napi(js_name = "__napiBindingTarget")]
pub fn binding_target() -> String {
  "addon-owned".to_owned()
}
`

const RESERVED_NAME_ERROR = /reserved by the generated binding loader/

// clipanion reports a failed command on stdout (`Cli.run` writes
// `this.error(...)` to `context.stdout`), so that is the stream to match.

test('a build that emits no loader does not reserve __napiBindingTarget', async (t) => {
  t.timeout(E2E_STEP_TIMEOUT)
  const { context } = t.context
  await writeCargoToml(context)
  await writeFile(join(context, 'src', 'lib.rs'), BINDING_TARGET_LIB_RS)
  await writePackageJson(context, {})
  const bin = join(context, 'node_modules', '.bin')
  const env = { ...process.env, FORCE_COLOR: '0' }

  // no `--platform`: a plain `index.node` build writes no loader at all
  const plain = await execResult(`${bin}/napi build`, { cwd: context, env })
  t.is(plain.code, 0, plain.stdout + plain.stderr)
  t.false(existsSync(join(context, 'index.js')))
  const dts = await readFile(join(context, 'index.d.ts'), 'utf8')
  // the addon keeps its own declaration, and nothing generated collides with it
  t.regex(dts, /export declare function __napiBindingTarget\(\): string/)
  t.false(dts.includes('export declare const __napiBindingTarget'))

  // `--no-js` suppresses the loader as well
  const noLoader = await execResult(`${bin}/napi build --platform --no-js`, {
    cwd: context,
    env,
  })
  t.is(noLoader.code, 0, noLoader.stdout + noLoader.stderr)
  t.false(existsSync(join(context, 'index.js')))

  // a build that does emit a loader still rejects the name
  const withLoader = await execResult(`${bin}/napi build --platform`, {
    cwd: context,
    env,
  })
  t.not(withLoader.code, 0)
  t.regex(withLoader.stdout, RESERVED_NAME_ERROR)
})

test('a regenerated WASI loader still reserves __napiBindingTarget', async (t) => {
  t.timeout(E2E_STEP_TIMEOUT)
  const { context } = t.context
  await writeCargoToml(context)
  await writeFile(join(context, 'src', 'lib.rs'), BINDING_TARGET_LIB_RS)
  await writePackageJson(context, {
    napi: {
      binaryName: 'napi-rs-cli-e2e',
      targets: ['wasm32-wasip1'],
    },
  })
  // What an earlier WASI build leaves behind. A native build regenerates that
  // loader set from this metadata, so the declaration is appended and the name
  // must stay reserved even though no root loader is written.
  await writeFile(
    join(context, 'napi-rs-cli-e2e.wasip1.cjs'),
    `// napi-rs-artifact-metadata:${JSON.stringify({
      version: 2,
      rootEntry: 'index.js',
      exports: ['sum'],
      managedRootEntries: ['browser.js', 'index.js'],
    })}\nmodule.exports = {}\nmodule.exports.sum = () => 0\n`,
  )
  await writeFile(
    join(context, 'napi-rs-cli-e2e.wasip1.d.cts'),
    'export declare function sum(a: number, b: number): number\n',
  )

  const bin = join(context, 'node_modules', '.bin')
  const result = await execResult(`${bin}/napi build`, {
    cwd: context,
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  t.not(result.code, 0)
  t.regex(result.stdout, RESERVED_NAME_ERROR)
})

async function execAsync(command: string, options: ExecOptions = {}) {
  return new Promise<void>((resolve, reject) => {
    const cp = exec(command, options, (_, stdout, stderr) => {
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    })
    cp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command ${command} failed with code ${code}`))
      }
      resolve()
    })
  })
}

async function execResult(command: string, options: ExecOptions = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      let stdout = ''
      let stderr = ''
      const cp = exec(command, options)
      cp.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      cp.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      cp.on('close', (code) => {
        resolve({
          code,
          stdout,
          stderr,
        })
      })
    },
  )
}

async function writeCargoToml(projectDir: string, cargoToml: string = '') {
  await writeFile(
    join(projectDir, 'Cargo.toml'),
    `[package]
name = "napi-rs-cli-e2e"
version = "1.0.0"
authors = ["napi-rs <dev@napi.rs>"]
edition = "2021"
[lib]
crate-type = ["cdylib"]
[dependencies]
napi = { path = "${posixJoin(rootDirPosix, 'crates', 'napi').substring(process.platform === 'win32' ? 1 : 0)}" }
napi-derive = { path = "${posixJoin(rootDirPosix, 'crates', 'macro').substring(process.platform === 'win32' ? 1 : 0)}" }
[build-dependencies]
napi-build = { path = "${posixJoin(rootDirPosix, 'crates', 'build').substring(process.platform === 'win32' ? 1 : 0)}" }
${cargoToml}
`,
  )

  await mkdir(join(projectDir, 'src'), { recursive: true })
  await writeFile(
    join(projectDir, 'src', 'lib.rs'),
    `use napi_derive::napi;

#[napi]
pub fn hello() -> String {
    "Hello, world!".to_string()
}
    `,
  )
  await writeFile(
    join(projectDir, 'build.rs'),
    `fn main() {
  napi_build::setup();
}`,
  )
}

async function writePackageJson(
  projectDir: string,
  extraPackageJson: Record<string, any>,
) {
  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: 'napi-rs-cli-e2e',
        version: '1.0.0',
        private: true,
        devDependencies: {
          '@napi-rs/cli': `file://${posixJoin(rootDirPosix, 'cli', `napi-rs-cli-${packageJson.version}.tgz`)}`,
        },
        ...extraPackageJson,
      },
      null,
      2,
    ),
  )
}
