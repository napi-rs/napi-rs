import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { join as posixJoin, sep as posixSep } from 'node:path/posix'
import { sep as win32Sep } from 'node:path/win32'
import { fileURLToPath } from 'node:url'

import ava, { type TestFn } from 'ava'
import ts from 'typescript'

import { buildProject } from '../build.js'
import { getSystemDefaultTarget } from '../../utils/index.js'

// End-to-end coverage for the `binaries[]` multi-binary build. A single
// workspace ships two addons — a `full` crate and a slim `client` crate, both
// re-exporting a `shared` dependency crate — and this suite drives real cargo
// builds through `buildProject`, then inspects the generated `.node`/`.js`/
// `.d.ts`. The pure expansion/validation logic is covered separately (and
// cheaply) by `normalize-config.spec.ts`; this file proves the warm-cache and
// cross-binary behavior that only a real build exercises:
//
//   1. clean build of both binaries produces both artifact sets;
//   2. building in the reverse order produces byte-identical type defs;
//   3. a fully warm compile still regenerates deleted js/dts (the
//      `NAPI_FORCE_BUILD_<CRATE>` re-emission path);
//   4. `--binary client` rebuilds only the client, leaving full untouched;
//   5. deleting only one binary's output and rebuilding it leaves the other's
//      output untouched (both directions);
//   6. the slim client's `.d.ts` never leaks a full-only export;
//   7. the shared crate's export appears identically in both `.d.ts`;
//   8. a consumer of each generated `.d.ts` type-checks.

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../../..')

const test = ava as TestFn<{
  tmpDir: string
  projectDir: string
}>

const localCratePath = (crate: string) =>
  posixJoin(repoRoot, 'crates', crate).replaceAll(win32Sep, posixSep)

const NAPI_PATH = localCratePath('napi')
const NAPI_DERIVE_PATH = localCratePath('macro')
const NAPI_BUILD_PATH = localCratePath('build')

async function writeWorkspace(projectDir: string) {
  // The shared crate calls `napi_build::setup()` too: that build script is what
  // emits `cargo::rerun-if-env-changed=NAPI_FORCE_BUILD_MATRIX_SHARED`, so the
  // CLI can force the shared crate to recompile and re-emit its type-def
  // fragment into each consuming binary's own cache folder. Without it a
  // fully-cached shared crate would never re-emit, and only whichever binary
  // was built first would see its exports.
  const sharedCargo = `[package]
name = "matrix_shared"
version = "0.1.0"
edition = "2021"

[dependencies]
napi = { path = "${NAPI_PATH}" }
napi-derive = { path = "${NAPI_DERIVE_PATH}" }

[build-dependencies]
napi-build = { path = "${NAPI_BUILD_PATH}" }
`

  const cdylibCargo = (name: string) => `[package]
name = "${name}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${NAPI_PATH}" }
napi-derive = { path = "${NAPI_DERIVE_PATH}" }
matrix_shared = { path = "../shared" }

[build-dependencies]
napi-build = { path = "${NAPI_BUILD_PATH}" }
`

  const buildRs = 'fn main() {\n    napi_build::setup();\n}\n'

  await Promise.all([
    mkdir(join(projectDir, 'shared', 'src'), { recursive: true }),
    mkdir(join(projectDir, 'full', 'src'), { recursive: true }),
    mkdir(join(projectDir, 'client', 'src'), { recursive: true }),
  ])

  await Promise.all([
    writeFile(
      join(projectDir, 'Cargo.toml'),
      '[workspace]\nresolver = "2"\nmembers = ["shared", "full", "client"]\n',
    ),
    // One package.json at the workspace root drives both binaries.
    writeFile(
      join(projectDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'matrix-multi-binary',
          version: '0.1.0',
          napi: {
            binaries: [
              {
                name: 'full',
                manifestPath: 'full/Cargo.toml',
                binaryName: 'index',
                js: 'index.js',
                dts: 'index.d.ts',
              },
              {
                name: 'client',
                manifestPath: 'client/Cargo.toml',
                binaryName: 'index-client',
                js: 'index-client.js',
                dts: 'index-client.d.ts',
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    ),
    // Shared crate: one `#[napi]` export both binaries re-export.
    writeFile(join(projectDir, 'shared', 'Cargo.toml'), sharedCargo),
    writeFile(join(projectDir, 'shared', 'build.rs'), buildRs),
    writeFile(
      join(projectDir, 'shared', 'src', 'lib.rs'),
      'use napi_derive::napi;\n\n#[napi]\npub fn shared() -> i32 {\n    1\n}\n',
    ),
    // Full crate: re-exports shared and adds a full-only export.
    writeFile(
      join(projectDir, 'full', 'Cargo.toml'),
      cdylibCargo('matrix_full'),
    ),
    writeFile(join(projectDir, 'full', 'build.rs'), buildRs),
    writeFile(
      join(projectDir, 'full', 'src', 'lib.rs'),
      'use napi_derive::napi;\n\npub use matrix_shared::*;\n\n#[napi]\npub fn fullonly() -> i32 {\n    2\n}\n',
    ),
    // Client crate: re-exports shared only (the slim build).
    writeFile(
      join(projectDir, 'client', 'Cargo.toml'),
      cdylibCargo('matrix_client'),
    ),
    writeFile(join(projectDir, 'client', 'build.rs'), buildRs),
    writeFile(
      join(projectDir, 'client', 'src', 'lib.rs'),
      'pub use matrix_shared::*;\n',
    ),
  ])
}

test.before(async (t) => {
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `multi-binary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  const projectDir = join(tmpDir, 'project')
  await mkdir(projectDir, { recursive: true })
  await writeWorkspace(projectDir)
  t.context = { tmpDir, projectDir }
})

test.after.always(async (t) => {
  if (t.context.tmpDir && existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

const abi = getSystemDefaultTarget().platformArchABI

// Build helper: runs the real pipeline with `CARGO` unset (a stray `CARGO`
// override would otherwise be spawned instead of `cargo`), returning outputs.
async function build(projectDir: string, binary?: string) {
  const originalCargo = process.env.CARGO
  delete process.env.CARGO
  try {
    const { task } = await buildProject({
      cwd: projectDir,
      outputDir: '.',
      platform: true,
      ...(binary ? { binary } : {}),
    })
    return await task
  } finally {
    if (originalCargo === undefined) {
      delete process.env.CARGO
    } else {
      process.env.CARGO = originalCargo
    }
  }
}

const outputs = {
  fullNode: (dir: string) => join(dir, `index.${abi}.node`),
  clientNode: (dir: string) => join(dir, `index-client.${abi}.node`),
  fullJs: (dir: string) => join(dir, 'index.js'),
  clientJs: (dir: string) => join(dir, 'index-client.js'),
  fullDts: (dir: string) => join(dir, 'index.d.ts'),
  clientDts: (dir: string) => join(dir, 'index-client.d.ts'),
}

const read = (path: string) => readFile(path, 'utf8')

/**
 * Type-check a small consumer against the two generated `.d.ts` files with the
 * TypeScript compiler API (equivalent to `tsc --noEmit`). The consumer also
 * asserts, via `@ts-expect-error`, that the full-only export is absent from the
 * slim client's types — if it leaked, the suppressed error would become an
 * "unused '@ts-expect-error'" diagnostic and fail the check.
 */
function typeCheckConsumer(projectDir: string): string[] {
  const consumerPath = join(projectDir, 'consumer.ts')
  const program = ts.createProgram([consumerPath], {
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  })
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    )
}

test.serial('binaries[] builds, warms, and isolates each output', async (t) => {
  // A cold `napi` compile plus several warm rebuilds; well beyond ava's default
  // per-test inactivity timeout.
  t.timeout(20 * 60 * 1000)

  const { projectDir } = t.context

  // --- Scenario 1: clean build of both binaries, in configured order. -------
  const built = await build(projectDir)
  t.deepEqual(
    built.map((output) => output.kind).sort(),
    ['dts', 'dts', 'js', 'js', 'node', 'node'],
    'both binaries each emit a node, js, and dts output',
  )

  for (const path of [
    outputs.fullNode(projectDir),
    outputs.clientNode(projectDir),
    outputs.fullJs(projectDir),
    outputs.clientJs(projectDir),
    outputs.fullDts(projectDir),
    outputs.clientDts(projectDir),
  ]) {
    t.true(existsSync(path), `expected ${path} to exist`)
  }

  const fullDts1 = await read(outputs.fullDts(projectDir))
  const clientDts1 = await read(outputs.clientDts(projectDir))

  // --- Scenario 6: the slim client never leaks the full-only export. --------
  t.regex(fullDts1, /export declare function shared\(\): number/)
  t.regex(fullDts1, /export declare function fullonly\(\): number/)
  t.regex(clientDts1, /export declare function shared\(\): number/)
  t.notRegex(
    clientDts1,
    /fullonly/,
    'the slim client must not expose the full-only export',
  )

  // --- Scenario 7: the shared export is identical in both type defs. --------
  const sharedDecl = /export declare function shared\(\): number/
  t.is(
    fullDts1.match(sharedDecl)?.[0],
    clientDts1.match(sharedDecl)?.[0],
    'the shared crate export renders identically in both binaries',
  )

  // --- Scenario 8: a consumer of both generated type defs type-checks. ------
  await writeFile(
    join(projectDir, 'consumer.ts'),
    [
      `import { shared, fullonly } from './index'`,
      `import { shared as clientShared } from './index-client'`,
      `// @ts-expect-error \`fullonly\` is a full-only export and must be absent from the slim client's types`,
      `import { fullonly as leaked } from './index-client'`,
      ``,
      `export const values: number[] = [shared(), fullonly(), clientShared()]`,
      `void leaked`,
      ``,
    ].join('\n'),
  )
  t.deepEqual(
    typeCheckConsumer(projectDir),
    [],
    'the generated type defs must type-check (and the slim client must lack `fullonly`)',
  )

  // --- Scenario 4: `--binary client` rebuilds only the client. --------------
  // Capture full's type def, rebuild just the client from a warm target, and
  // confirm full's output was not touched.
  const fullDtsBefore = await read(outputs.fullDts(projectDir))
  await build(projectDir, 'client')
  t.is(
    await read(outputs.fullDts(projectDir)),
    fullDtsBefore,
    'selecting the client must leave the full type def untouched',
  )
  t.is(
    await read(outputs.clientDts(projectDir)),
    clientDts1,
    'the reselected client type def is reproduced identically',
  )

  // --- Scenario 3: a fully warm compile still regenerates deleted js/dts. ---
  // This is the `NAPI_FORCE_BUILD_<CRATE>` re-emission path: nothing in the
  // Rust sources changed, so the compile is fully cached, yet the shared
  // crate's type-def fragment must be re-emitted into each binary's (empty)
  // cache folder for the deleted files to come back.
  await Promise.all([
    rm(outputs.fullJs(projectDir)),
    rm(outputs.clientJs(projectDir)),
    rm(outputs.fullDts(projectDir)),
    rm(outputs.clientDts(projectDir)),
  ])
  await build(projectDir)
  t.true(existsSync(outputs.fullJs(projectDir)))
  t.true(existsSync(outputs.clientJs(projectDir)))
  t.is(
    await read(outputs.fullDts(projectDir)),
    fullDts1,
    'a warm rebuild regenerates the full type def identically',
  )
  t.is(
    await read(outputs.clientDts(projectDir)),
    clientDts1,
    'a warm rebuild regenerates the client type def identically',
  )

  // --- Scenario 5: delete only one binary's output, rebuild it, the other's
  // output stays untouched — checked in both directions. --------------------
  await rm(outputs.fullDts(projectDir))
  const clientDtsPinned = await read(outputs.clientDts(projectDir))
  await build(projectDir, 'full')
  t.true(existsSync(outputs.fullDts(projectDir)), 'full regenerates')
  t.is(
    await read(outputs.clientDts(projectDir)),
    clientDtsPinned,
    'rebuilding full leaves the client output untouched',
  )

  await rm(outputs.clientDts(projectDir))
  const fullDtsPinned = await read(outputs.fullDts(projectDir))
  await build(projectDir, 'client')
  t.true(existsSync(outputs.clientDts(projectDir)), 'client regenerates')
  t.is(
    await read(outputs.fullDts(projectDir)),
    fullDtsPinned,
    'rebuilding the client leaves the full output untouched',
  )

  // --- Scenario 2: building in reverse order is byte-identical. -------------
  // Wipe all generated bindings and rebuild client-first, then full; the type
  // defs must match the original configured-order build.
  await Promise.all([
    rm(outputs.fullJs(projectDir), { force: true }),
    rm(outputs.clientJs(projectDir), { force: true }),
    rm(outputs.fullDts(projectDir), { force: true }),
    rm(outputs.clientDts(projectDir), { force: true }),
  ])
  await build(projectDir, 'client')
  await build(projectDir, 'full')
  t.is(
    await read(outputs.fullDts(projectDir)),
    fullDts1,
    'reverse-order full type def matches the configured-order build',
  )
  t.is(
    await read(outputs.clientDts(projectDir)),
    clientDts1,
    'reverse-order client type def matches the configured-order build',
  )
})
