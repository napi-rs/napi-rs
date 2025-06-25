import { exec, type ExecOptions } from 'node:child_process'
import { join } from 'node:path'
// use posix path to prevent `\` on Windows
import { join as posixJoin } from 'node:path/posix'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'

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

test.before(async () => {
  await execAsync(`yarn workspace @napi-rs/cli build`, {
    cwd: rootDir,
  })
  await execAsync(`npm pack`, {
    cwd: join(rootDir, 'cli'),
  })
})

test.beforeEach(async (t) => {
  const random = Math.random().toString(36).slice(2)
  t.context.context = join(tmpdir(), 'napi-rs-cli-e2e', random)
  await mkdir(t.context.context, { recursive: true })
  await writePackageJson(t.context.context, {})
  await execAsync(`npm install`, {
    cwd: t.context.context,
  })
})

test.afterEach(async (t) => {
  await rm(t.context.context, { recursive: true, force: true })
})

test('should print help', async (t) => {
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

test('should throw error when duplicate targets are provided', async (t) => {
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
