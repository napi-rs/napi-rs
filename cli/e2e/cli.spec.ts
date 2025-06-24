import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

import ava, { type TestFn } from 'ava'

import packageJson from '../package.json' with { type: 'json' }
import { fileURLToPath } from 'node:url'

const test = ava as TestFn<{
  context: string
}>

test.beforeEach((t) => {
  const random = Math.random().toString(36).slice(2)
  t.context.context = join(tmpdir(), 'napi-rs-cli-e2e', random)
  mkdirSync(t.context.context, { recursive: true })
  execSync(`yarn workspace @napi-rs/cli build`, {
    cwd: join(fileURLToPath(import.meta.url), '..', '..', '..'),
  })
  execSync(`npm pack`, {
    cwd: join(fileURLToPath(import.meta.url), '..', '..'),
  })
  writeFileSync(
    join(t.context.context, 'package.json'),
    JSON.stringify(
      {
        name: 'napi-rs-cli-e2e',
        version: '1.0.0',
        private: true,
        devDependencies: {
          '@napi-rs/cli': `file:${join(fileURLToPath(import.meta.url), '..', '..', `napi-rs-cli-${packageJson.version}.tgz`)}`,
        },
      },
      null,
      2,
    ),
  )
  execSync(`npm install`, {
    cwd: t.context.context,
  })
})

test.afterEach((t) => {
  rmSync(t.context.context, { recursive: true, force: true })
})

test('should print help', (t) => {
  const bin = join(t.context.context, 'node_modules', '.bin')
  execSync(`${bin}/napi --help`, {
    stdio: 'inherit',
  })
  execSync(`${bin}/napi build --help`, {
    stdio: 'inherit',
  })
  execSync(`${bin}/napi version --help`, {
    stdio: 'inherit',
  })
  execSync(`${bin}/napi pre-publish --help`, {
    stdio: 'inherit',
  })
  execSync(`${bin}/napi create-npm-dirs --help`, {
    stdio: 'inherit',
  })
  execSync(`${bin}/napi new --help`, {
    stdio: 'inherit',
  })
  execSync(`${bin}/napi rename --help`, {
    stdio: 'inherit',
  })
  execSync(`${bin}/napi version --help`, {
    stdio: 'inherit',
  })
  t.pass()
})
