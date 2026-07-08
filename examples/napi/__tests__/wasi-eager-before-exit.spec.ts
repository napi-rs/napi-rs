import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const isWasi = Boolean(process.env.WASI_TEST)
const __dirname = dirname(fileURLToPath(import.meta.url))
const cleanupPreservationHelper = join(
  __dirname,
  'wasi-eager-cleanup-preservation.js',
)
const wasiLoaderSuffix =
  process.env.NAPI_RS_WASI_FLAVOR === 'wasm32-wasip1' ? 'wasip1' : 'wasi'
const publicLoaders = [
  {
    name: 'examples/napi',
    path: join(__dirname, `../example.${wasiLoaderSuffix}.cjs`),
  },
  ...(wasiLoaderSuffix === 'wasip1'
    ? [
        {
          name: 'custom runtime',
          path: join(
            __dirname,
            '../../custom-async-runtime/custom_async_runtime.wasip1.cjs',
          ),
        },
      ]
    : []),
]

test.skipIf(!isWasi)(
  'eager WASI binding remains usable when beforeExit resumes work',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'wasi-eager-before-exit.js'), wasiLoaderSuffix],
      {
        encoding: 'utf8',
        env: process.env,
        timeout: 30_000,
      },
    )
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /eager beforeExit lifecycle passed/)
  },
)

for (const fault of [
  'exit-registration',
  'before-exit-removal',
  'handoff-rollback',
] as const) {
  test.skipIf(!isWasi)(
    `eager WASI cleanup handoff is transactional after ${fault}`,
    (t) => {
      const result = spawnSync(
        process.execPath,
        [
          join(__dirname, 'wasi-eager-cleanup-handoff.js'),
          wasiLoaderSuffix,
          fault,
        ],
        {
          encoding: 'utf8',
          env: process.env,
          timeout: 30_000,
        },
      )
      const output = `${result.stdout}\n${result.stderr}`
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, output)
      t.is(result.status, 0, output)
      t.regex(result.stdout, /eager cleanup handoff passed/)
    },
  )
}

for (const loader of publicLoaders) {
  for (const scenario of [
    'primitive-rejection',
    'occupied-cause-removal',
  ] as const) {
    test.skipIf(!isWasi)(
      `${loader.name} eager WASI loader preserves ${scenario}`,
      (t) => {
        t.true(
          existsSync(loader.path),
          `generated WASI loader is missing: ${loader.path}`,
        )
        const result = spawnSync(
          process.execPath,
          [cleanupPreservationHelper, loader.path, scenario],
          {
            encoding: 'utf8',
            env: process.env,
            timeout: 30_000,
          },
        )
        const output = `${result.stdout}\n${result.stderr}`
        t.is(result.error, undefined, result.error?.stack)
        t.is(result.signal, null, output)
        t.is(result.status, 0, output)
        t.regex(result.stdout, /eager cleanup preservation passed/)
      },
    )
  }
}
