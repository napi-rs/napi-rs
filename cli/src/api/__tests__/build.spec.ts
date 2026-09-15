import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { exec, spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { join as posixJoin, sep as posixSep } from 'node:path/posix'
import { sep as win32Sep } from 'node:path/win32'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ava, { type ExecutionContext, type TestFn } from 'ava'
import { parseSync } from 'oxc-parser'

import {
  bindingTargetDeclarationPredicate,
  buildProject,
  checkAsyncRuntimeHostContract,
  EMNAPI_WASI_SDK_34_LINK_DIR,
  ensureBindingTargetDeclaration,
  generateTypeDef,
  napiCrossToolchainEnvs,
  prepareWasiBindingTypeDef,
  resolveBuildFormat,
  selectEmnapiLinkDir,
  validateCrossCompileFlags,
  validateNapiCrossSupport,
  writeJsBinding,
} from '../build.js'
import { getSystemDefaultTarget } from '../../utils/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../../..')

const test = ava as TestFn<{
  tmpDir: string
  projectDir: string
  typeDefDir: string
}>

test.beforeEach(async (t) => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const tmpDir = posixJoin(
    tmpdir(),
    'napi-rs-test',
    `build-spec-${timestamp}-${random}`,
  )
  const projectDir = posixJoin(tmpDir, 'project')
  const typeDefDir = posixJoin(projectDir, 'target', 'type-def')

  await mkdir(typeDefDir, { recursive: true })

  t.context = { tmpDir, projectDir, typeDefDir }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('build pipeline generates bindings and artifacts', async (t) => {
  const { projectDir, typeDefDir } = t.context
  const crateName = 'build_integration'
  const binaryName = 'build-integration'
  const packageName = 'build-integration'
  const version = '0.1.0'
  const target = getSystemDefaultTarget()

  const napiPath = posixJoin(repoRoot, 'crates', 'napi').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiDerivePath = posixJoin(repoRoot, 'crates', 'macro').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiBuildPath = posixJoin(repoRoot, 'crates', 'build').replaceAll(
    win32Sep,
    posixSep,
  )

  await mkdir(join(projectDir, 'src'), { recursive: true })

  const cargoToml = `[package]
name = "${crateName}"
version = "${version}"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${napiPath}" }
napi-derive = { path = "${napiDerivePath}" }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`

  await writeFile(join(projectDir, 'Cargo.toml'), cargoToml)
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        napi: {
          binaryName,
          targets: [target.triple],
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(projectDir, 'build.rs'),
    'fn main() {\n    napi_build::setup();\n}\n',
  )
  await writeFile(
    join(projectDir, 'src', 'lib.rs'),
    'use napi_derive::napi;\n\n#[napi]\npub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
  )

  const buildCmd = `cargo build --target ${target.triple}`

  await new Promise<void>((resolve, reject) => {
    const child = exec(buildCmd, {
      cwd: projectDir,
      env: { ...process.env, NAPI_TYPE_DEF_TMP_FOLDER: typeDefDir },
    })
    child.stderr?.on('data', (data) => {
      console.error(data.toString())
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`cargo build exited with code ${code ?? 'null'}`))
      }
    })
    child.on('error', reject)
  })

  const files = await readdir(typeDefDir)
  t.true(files.length > 0, 'type definition files should be generated')

  const { exports, dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
  })

  t.true(exports.includes('sum'), 'generateTypeDef should expose napi exports')

  const jsBinding = await writeJsBinding({
    platform: true,
    idents: exports,
    binaryName,
    packageName,
    version,
    outputDir: projectDir,
  })

  t.truthy(jsBinding)
  t.is(jsBinding?.path, join(projectDir, 'index.js'))

  const libName = crateName.replace(/-/g, '_')
  const srcName =
    target.platform === 'darwin'
      ? `lib${libName}.dylib`
      : target.platform === 'win32'
        ? `${libName}.dll`
        : `lib${libName}.so`
  const profile = 'debug'
  const srcPath = join(projectDir, 'target', target.triple, profile, srcName)
  t.true(existsSync(srcPath), 'compiled artifact should exist')

  const destName = `${binaryName}.${target.platformArchABI}.${srcName.endsWith('.wasm') ? 'wasm' : 'node'}`
  const destPath = join(projectDir, destName)
  await copyFile(srcPath, destPath)
  t.true(existsSync(destPath), 'artifact should be copied to output directory')

  const nodeStat = await stat(destPath)
  t.true(nodeStat.size > 0)

  t.regex(dts, /export declare function sum\(a: number, b: number\): number/)

  const jsPath = join(projectDir, 'index.js')
  t.true(existsSync(jsPath))
  const jsContent = await readFile(jsPath, 'utf-8')
  t.regex(jsContent, /module\.exports\.sum = nativeBinding\.sum/)
})

test('writeJsBinding uses the explicit format independently of the filename', async (t) => {
  const { projectDir } = t.context
  const commonjsPath = join(projectDir, 'binding.cjs')
  const esmPath = join(projectDir, 'binding.js')
  const legacyEsmPath = join(projectDir, 'legacy.js')

  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
    jsBinding: 'binding.cjs',
    format: 'commonjs',
  })
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
    jsBinding: 'binding.js',
    format: 'esm',
  })
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
    jsBinding: 'legacy.js',
    esm: true,
  })

  const [commonjs, esm, legacyEsm] = await Promise.all([
    readFile(commonjsPath, 'utf8'),
    readFile(esmPath, 'utf8'),
    readFile(legacyEsmPath, 'utf8'),
  ])

  t.regex(commonjs, /module\.exports\.sum = nativeBinding\.sum/)
  t.regex(esm, /export \{ sum \}/)
  t.regex(legacyEsm, /export \{ sum \}/)
  t.regex(
    commonjs,
    /module\.exports\.__napiBindingTarget = __napiStampBindingTarget\(nativeBinding, __napiLoadedBindingTarget\)/,
  )
  t.regex(esm, /export const __napiBindingTarget = __napiLoadedBindingTarget/)
  t.regex(
    legacyEsm,
    /export const __napiBindingTarget = __napiLoadedBindingTarget/,
  )
})

test('writeJsBinding rejects a napi export named __napiBindingTarget', async (t) => {
  await t.throwsAsync(
    writeJsBinding({
      platform: true,
      idents: ['__napiBindingTarget'],
      binaryName: 'build-integration',
      packageName: 'build-integration',
      version: '0.1.0',
      outputDir: t.context.projectDir,
    }),
    { message: /reserved by the generated binding loader/ },
  )
})

test('the generated loader reports the flavor its library-path override loaded', async (t) => {
  const { projectDir } = t.context
  const overridePath = join(projectDir, 'fake-wasip1.cjs')
  const plainPath = join(projectDir, 'fake-native.cjs')
  await Promise.all([
    // a stand-in for a generated WASI loader: it reports its own flavor
    writeFile(
      overridePath,
      `module.exports = { sum: (a, b) => a + b }\nmodule.exports.__napiBindingTarget = 'wasm32-wasip1'\n`,
    ),
    writeFile(plainPath, `module.exports = { sum: (a, b) => a + b }\n`),
  ])
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
  })
  const rootPath = join(projectDir, 'index.js')

  const probe = (libraryPath: string) => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        // require the override FIRST: the root loader aliases it, so an
        // unconditional assignment would rewrite the override's own marker
        `const override = require(${JSON.stringify(libraryPath)})
const root = require(${JSON.stringify(rootPath)})
console.log(
  JSON.stringify({
    root: root.__napiBindingTarget,
    override: override.__napiBindingTarget,
    aliased: root === override,
    sum: root.sum(1, 2),
  }),
)`,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, NAPI_RS_NATIVE_LIBRARY_PATH: libraryPath },
      },
    )
    t.is(result.status, 0, `${result.stdout}\n${result.stderr}`)
    return JSON.parse(result.stdout)
  }

  t.deepEqual(probe(overridePath), {
    root: 'wasm32-wasip1',
    override: 'wasm32-wasip1',
    aliased: true,
    sum: 3,
  })
  t.deepEqual(probe(plainPath), {
    root: 'native',
    override: 'native',
    aliased: true,
    sum: 3,
  })
})

// A stand-in for a `#[napi(module_exports)]` hook: it attaches names to the
// addon's exports object imperatively, so napi-rs type generation never sees
// them and `assertBindingTargetIdentFree` cannot either. Only the loader can.
const writeFakePlatformPackage = async (projectDir: string, source: string) => {
  const { platformArchABI } = getSystemDefaultTarget()
  const packageDir = join(
    projectDir,
    'node_modules',
    `build-integration-${platformArchABI}`,
  )
  await mkdir(packageDir, { recursive: true })
  await Promise.all([
    writeFile(
      join(packageDir, 'package.json'),
      `{"name":"build-integration-${platformArchABI}","version":"0.1.0","main":"index.js"}\n`,
    ),
    writeFile(join(packageDir, 'index.js'), source),
  ])
}

const requireRootLoaderInChild = (rootPath: string, body: string) =>
  spawnSync(
    process.execPath,
    ['-e', `const binding = require(${JSON.stringify(rootPath)})\n${body}`],
    { encoding: 'utf8' },
  )

test('a module_exports hook may not claim __napiBindingTarget', async (t) => {
  const { projectDir } = t.context
  await writeFakePlatformPackage(
    projectDir,
    `const exportsObject = { sum: (a, b) => a + b }
exportsObject.__napiBindingTarget = 'addon-owned-value'
module.exports = exportsObject
`,
  )
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
  })

  const result = requireRootLoaderInChild(
    join(projectDir, 'index.js'),
    `console.log(binding.__napiBindingTarget)`,
  )
  t.not(result.status, 0, `${result.stdout}\n${result.stderr}`)
  t.regex(result.stderr, /reserved by the generated binding loader/)
  t.regex(result.stderr, /ERR_NAPI_BINDING_TARGET_CONFLICT/)
})

test('a zero-ident package still rejects a claimed binding target', async (t) => {
  const { projectDir } = t.context
  // the `!enableTypeDef` shape: no type-def metadata at all, so the build-time
  // assertion has an empty list to check and the loader is the only guard left
  await writeFakePlatformPackage(
    projectDir,
    `const exportsObject = { sum: (a, b) => a + b }
exportsObject.__napiBindingTarget = 'addon-owned-value'
module.exports = exportsObject
`,
  )
  await writeJsBinding({
    platform: true,
    idents: [],
    wasiFlavors: ['wasm32-wasi'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
  })

  const result = requireRootLoaderInChild(
    join(projectDir, 'index.js'),
    `console.log(binding.__napiBindingTarget)`,
  )
  t.not(result.status, 0, `${result.stdout}\n${result.stderr}`)
  t.regex(result.stderr, /ERR_NAPI_BINDING_TARGET_CONFLICT/)
})

test('a frozen addon loads without the binding target stamp', async (t) => {
  const { projectDir } = t.context
  // `Object::freeze` in a `#[napi(module_exports)]` hook. Reporting the
  // artifact is metadata; it must never fail an otherwise successful load.
  await writeFakePlatformPackage(
    projectDir,
    `module.exports = Object.freeze({ sum: (a, b) => a + b })\n`,
  )
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
  })

  const result = requireRootLoaderInChild(
    join(projectDir, 'index.js'),
    `console.log(
  JSON.stringify({
    sum: binding.sum(1, 2),
    target: binding.__napiBindingTarget ?? null,
  }),
)`,
  )
  t.is(result.status, 0, `${result.stdout}\n${result.stderr}`)
  t.deepEqual(JSON.parse(result.stdout), { sum: 3, target: null })
})

// Node's CJS -> ESM named export detection is `cjs-module-lexer`, a static
// scanner: it reports `__napiBindingTarget` only when it can see
// `module.exports.__napiBindingTarget =` in the source. A bare guard call is
// invisible to it, and the import then fails to link at all.
const importBindingTargetInChild = (rootPath: string) =>
  spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { __napiBindingTarget } from ${JSON.stringify(
        pathToFileURL(rootPath).href,
      )}
console.log(JSON.stringify(__napiBindingTarget))`,
    ],
    { encoding: 'utf8' },
  )

test('the CommonJS loader exposes __napiBindingTarget as an ESM named export', async (t) => {
  const { projectDir } = t.context
  await writeFakePlatformPackage(
    projectDir,
    `module.exports = { sum: (a, b) => a + b }\n`,
  )
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
  })

  const result = importBindingTargetInChild(join(projectDir, 'index.js'))
  t.is(result.status, 0, `${result.stdout}\n${result.stderr}`)
  t.is(result.stdout.trim(), '"native"')
})

test('a frozen addon keeps __napiBindingTarget importable, just undefined', async (t) => {
  const { projectDir } = t.context
  // The lexer is static, so the name links either way; the runtime skip is what
  // leaves it undefined. A named import that throws `SyntaxError` at link time
  // would be a much louder break than a missing value.
  await writeFakePlatformPackage(
    projectDir,
    `module.exports = Object.freeze({ sum: (a, b) => a + b })\n`,
  )
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
  })

  const result = importBindingTargetInChild(join(projectDir, 'index.js'))
  t.is(result.status, 0, `${result.stdout}\n${result.stderr}`)
  t.is(result.stdout.trim(), 'undefined')
})

// `Object.create(proto)` in a `#[napi(module_exports)]` hook — napi-rs itself
// reaches `Object.setPrototypeOf` off the global, so the prototype an addon's
// exports object carries is not beyond an addon's reach. `hasOwnProperty` does
// not see an inherited accessor, so an ordinary assignment would reach its
// setter.
const inheritedBindingTargetAccessor = (setterBody: string) =>
  `const proto = {}
Object.defineProperty(proto, '__napiBindingTarget', {
  get() {
    return undefined
  },
  set() {
    ${setterBody}
  },
  configurable: true,
})
const exportsObject = Object.create(proto)
exportsObject.sum = (a, b) => a + b
module.exports = exportsObject
`

const REPORT_BINDING_TARGET = `console.log(
  JSON.stringify({
    sum: binding.sum(1, 2),
    target: binding.__napiBindingTarget ?? null,
    own: Object.prototype.hasOwnProperty.call(binding, '__napiBindingTarget'),
  }),
)`

test('an addon whose prototype carries __napiBindingTarget still loads and reports its target', async (t) => {
  const { projectDir } = t.context
  // The throwing half: an inherited setter that refuses the write would kill an
  // otherwise successful load at the stamp — the same regression the frozen
  // skip above exists to prevent.
  await writeFakePlatformPackage(
    projectDir,
    inheritedBindingTargetAccessor(`throw new Error('addon setter refused')`),
  )
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
  })

  const result = requireRootLoaderInChild(
    join(projectDir, 'index.js'),
    REPORT_BINDING_TARGET,
  )
  t.is(result.status, 0, `${result.stdout}\n${result.stderr}`)
  t.deepEqual(JSON.parse(result.stdout), {
    sum: 3,
    target: 'native',
    own: true,
  })
})

test('an inherited setter does not swallow the binding target', async (t) => {
  const { projectDir } = t.context
  // The absorbing half: the setter accepts the write and creates nothing, so
  // both `require(...).__napiBindingTarget` and the ESM named import resolve to
  // `undefined` while the generated `.d.ts` promises a literal.
  await writeFakePlatformPackage(projectDir, inheritedBindingTargetAccessor(''))
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
  })

  const required = requireRootLoaderInChild(
    join(projectDir, 'index.js'),
    REPORT_BINDING_TARGET,
  )
  t.is(required.status, 0, `${required.stdout}\n${required.stderr}`)
  t.deepEqual(JSON.parse(required.stdout), {
    sum: 3,
    target: 'native',
    own: true,
  })

  // and the value the lexer-linked named import reads is the one on that same
  // object, so the stamp has to land as an own property for the import to work
  const imported = importBindingTargetInChild(join(projectDir, 'index.js'))
  t.is(imported.status, 0, `${imported.stdout}\n${imported.stderr}`)
  t.is(imported.stdout.trim(), '"native"')
})

test('an exotic binding object never fails the load', async (t) => {
  const { projectDir } = t.context
  // A `Proxy` whose `defineProperty` trap refuses is the one shape the stamp
  // cannot satisfy. Today's assignment is a sloppy-mode no-op there and a bare
  // `Object.defineProperty` would throw, so the skip is what keeps the rule the
  // frozen case states: metadata never fails an otherwise successful load.
  await writeFakePlatformPackage(
    projectDir,
    `module.exports = new Proxy(
  { sum: (a, b) => a + b },
  { defineProperty: () => false },
)
`,
  )
  await writeJsBinding({
    platform: true,
    idents: ['sum'],
    binaryName: 'build-integration',
    packageName: 'build-integration',
    version: '0.1.0',
    outputDir: projectDir,
  })

  const result = requireRootLoaderInChild(
    join(projectDir, 'index.js'),
    REPORT_BINDING_TARGET,
  )
  t.is(result.status, 0, `${result.stdout}\n${result.stderr}`)
  t.deepEqual(JSON.parse(result.stdout), {
    sum: 3,
    target: null,
    own: false,
  })
})

const bindingTargetDeclarationOf = (source: string) =>
  source
    .split('\n')
    .find((line) => line.startsWith('export declare const __napiBindingTarget'))

test('the declared binding target covers every loadable artifact', async (t) => {
  const { projectDir, typeDefDir } = t.context
  await writeFile(
    join(typeDefDir, 'sum.type'),
    '{"kind":"fn","name":"sum","def":"function sum(a: number, b: number): number"}\n',
  )

  const { dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
  })

  // Nothing here declares a WASI target, yet NAPI_RS_NATIVE_LIBRARY_PATH may
  // still point the loader at a generated WASI loader, which the root entry
  // then reports. A union of only the configured targets would make TypeScript
  // reject those comparisons.
  t.is(
    bindingTargetDeclarationOf(dts),
    "export declare const __napiBindingTarget: 'native' | 'wasm32-wasi' | 'wasm32-wasip1'",
  )

  const { dts: withoutLoader } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
  })

  t.false(withoutLoader.includes('__napiBindingTarget'))
})

test('a preserved WASI declaration gains the binding target declaration', async (t) => {
  const { projectDir, typeDefDir } = t.context
  await writeFile(
    join(typeDefDir, 'sum.type'),
    '{"kind":"fn","name":"sum","def":"function sum(a: number, b: number): number"}\n',
  )
  const { dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
  })

  // what a WASI build before `__napiBindingTarget` left on disk
  const preserved = `/* auto-generated by NAPI-RS */

export declare function sum(a: number, b: number): number
`
  const refreshed = ensureBindingTargetDeclaration(preserved)

  t.true(refreshed.startsWith(preserved))
  t.is(bindingTargetDeclarationOf(refreshed), bindingTargetDeclarationOf(dts))
  // a second build must not append a second declaration
  t.is(ensureBindingTargetDeclaration(refreshed), refreshed)
  // an already declared file is left untouched wherever it declares it
  t.is(ensureBindingTargetDeclaration(dts), dts)

  // a declaration file without type generation exports by assignment, which
  // cannot carry a named export declaration
  const exportAssignment = `declare const binding: Record<string, unknown>
export = binding
`
  t.is(ensureBindingTargetDeclaration(exportAssignment), exportAssignment)
})

test('a WASI flavor declaration names only that flavor', async (t) => {
  const { projectDir, typeDefDir } = t.context
  await writeFile(
    join(typeDefDir, 'sum.type'),
    '{"kind":"fn","name":"sum","def":"function sum(a: number, b: number): number"}\n',
  )
  const { dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
  })

  // a flavor's loaders report a compile-time-fixed identity, so the union the
  // root entry inherits from `NAPI_RS_NATIVE_LIBRARY_PATH` is unreachable here
  const threaded = ensureBindingTargetDeclaration(dts, 'wasm32-wasi')
  t.is(
    bindingTargetDeclarationOf(threaded),
    "export declare const __napiBindingTarget: 'wasm32-wasi'",
  )
  const threadless = ensureBindingTargetDeclaration(dts, 'wasm32-wasip1')
  t.is(
    bindingTargetDeclarationOf(threadless),
    "export declare const __napiBindingTarget: 'wasm32-wasip1'",
  )
  // narrowing replaces the inherited union instead of declaring the name twice
  t.is(threaded.split('__napiBindingTarget').length - 1, 1)

  // a second build must not append a second declaration
  t.is(ensureBindingTargetDeclaration(threadless, 'wasm32-wasip1'), threadless)

  // a preserved file that never declared it gains the flavor literal, not the
  // union
  const preserved = `/* auto-generated by NAPI-RS */

export declare function sum(a: number, b: number): number
`
  t.is(
    bindingTargetDeclarationOf(
      ensureBindingTargetDeclaration(preserved, 'wasm32-wasi'),
    ),
    "export declare const __napiBindingTarget: 'wasm32-wasi'",
  )

  // the root entry keeps the union (see `NAPI_RS_NATIVE_LIBRARY_PATH`)
  t.is(ensureBindingTargetDeclaration(dts), dts)

  // a build without `napi-derive`'s `type-def` feature exports by assignment,
  // which cannot carry a named export declaration
  const exportAssignment = `declare const binding: Record<string, unknown>
export = binding
`
  t.is(
    ensureBindingTargetDeclaration(exportAssignment, 'wasm32-wasip1'),
    exportAssignment,
  )
})

test('a mention of __napiBindingTarget is not a declaration of it', (t) => {
  // napi-derive copies `js_doc` into the `.d.ts` verbatim, so a doc comment can
  // name the export without declaring it
  const mentionOnly = `/* auto-generated by NAPI-RS */

/**
 * Mirrors the loader's \`__napiBindingTarget\` export.
 */
export declare function bindingTarget(): string
`
  t.is(
    bindingTargetDeclarationOf(
      ensureBindingTargetDeclaration(mentionOnly, 'wasm32-wasip1'),
    ),
    "export declare const __napiBindingTarget: 'wasm32-wasip1'",
  )

  // `assertBindingTargetIdentFree` only rejects the exact name, so a longer
  // identifier is a legal export and not this declaration
  const longerIdent = `/* auto-generated by NAPI-RS */

export declare const __napiBindingTargetInfo: string
`
  const refreshed = ensureBindingTargetDeclaration(longerIdent, 'wasm32-wasi')
  t.true(refreshed.startsWith(longerIdent))
  t.true(
    refreshed.includes(
      "export declare const __napiBindingTarget: 'wasm32-wasi'\n",
    ),
  )
})

test('a fresh WASI declaration narrows the inherited root union', async (t) => {
  const { projectDir, typeDefDir } = t.context
  await writeFile(
    join(typeDefDir, 'sum.type'),
    '{"kind":"fn","name":"sum","def":"function sum(a: number, b: number): number"}\n',
  )
  const { dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
  })

  // the fresh path derives the flavor declaration from the root `index.d.ts`,
  // which carries the union
  const prepared = prepareWasiBindingTypeDef(
    dts,
    join(projectDir, 'index.d.ts'),
    join(projectDir, 'pkg.wasip1.d.cts'),
    false,
  )
  t.is(
    bindingTargetDeclarationOf(
      ensureBindingTargetDeclaration(prepared, 'wasm32-wasip1'),
    ),
    "export declare const __napiBindingTarget: 'wasm32-wasip1'",
  )
})

const ROOT_BINDING_TARGET_DECLARATION =
  "export declare const __napiBindingTarget: 'native' | 'wasm32-wasi' | 'wasm32-wasip1'"

test('a crate without type defs still declares the binding target', async (t) => {
  const { projectDir, typeDefDir } = t.context

  // A crate can register every export from a `#[napi(module_exports)]` hook and
  // emit no `.type` file at all. A loader is still written for it, and that
  // loader still exports `__napiBindingTarget`.
  const { exports, dts, dtsWithTypeImports } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
  })

  t.is(exports.length, 0)
  t.is(bindingTargetDeclarationOf(dts), ROOT_BINDING_TARGET_DECLARATION)
  t.true(dts.startsWith('/* auto-generated by NAPI-RS */'))
  t.is(dtsWithTypeImports, dts)
})

test('a missing type def directory still declares the binding target', async (t) => {
  const { projectDir, typeDefDir } = t.context

  const { exports, dts, dtsWithTypeImports } = await generateTypeDef({
    typeDefDir: join(typeDefDir, 'missing'),
    cwd: projectDir,
    declareBindingTarget: true,
  })

  t.is(exports.length, 0)
  t.is(bindingTargetDeclarationOf(dts), ROOT_BINDING_TARGET_DECLARATION)
  t.true(dts.startsWith('/* auto-generated by NAPI-RS */'))
  t.is(dtsWithTypeImports, dts)
})

test('a build that emits no loader declares nothing without type defs', async (t) => {
  const { projectDir, typeDefDir } = t.context

  const empty = await generateTypeDef({ typeDefDir, cwd: projectDir })
  t.is(empty.dts, '')
  t.is(empty.dtsWithTypeImports, '')

  const missing = await generateTypeDef({
    typeDefDir: join(typeDefDir, 'missing'),
    cwd: projectDir,
  })
  t.is(missing.dts, '')
  t.is(missing.dtsWithTypeImports, '')
})

test('the declaration-only type def honours the header options', async (t) => {
  const { projectDir, typeDefDir } = t.context

  const { dts: headerless } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    noDtsHeader: true,
  })
  t.false(headerless.includes('/* auto-generated by NAPI-RS */'))
  t.is(bindingTargetDeclarationOf(headerless), ROOT_BINDING_TARGET_DECLARATION)

  const { dts: custom } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    dtsHeader: '/* custom */\n',
  })
  t.true(custom.startsWith('/* custom */\n'))
  t.is(bindingTargetDeclarationOf(custom), ROOT_BINDING_TARGET_DECLARATION)
})

const countBindingTargetDeclarations = (source: string) =>
  source
    .split('\n')
    .filter((line) =>
      line.startsWith('export declare const __napiBindingTarget'),
    ).length

test('a header that already declares the binding target is not declared twice', async (t) => {
  const { projectDir, typeDefDir } = t.context

  // a project that worked around loaders predating the export by declaring it
  // in its own header; a second declaration beside it is a TS2451 redeclaration
  const headerDeclaration =
    "export declare const __napiBindingTarget: 'native' | 'wasm32-wasi' | 'wasm32-wasip1'"
  const dtsHeader = `/* auto-generated by NAPI-RS */

${headerDeclaration}
`

  await writeFile(
    join(typeDefDir, 'sum.type'),
    '{"kind":"fn","name":"sum","def":"function sum(a: number, b: number): number"}\n',
  )

  const { dts, dtsWithTypeImports, header } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    dtsHeader,
  })
  t.is(countBindingTargetDeclarations(dts), 1)
  t.is(countBindingTargetDeclarations(dtsWithTypeImports), 1)
  t.is(bindingTargetDeclarationOf(dts), headerDeclaration)
  // the rendered header comes back, so the WASI writer can tell a declaration
  // the header owns from one this build appended
  t.is(header, dtsHeader)

  // the same header with no `.type` files at all: the declaration-only path
  const emptyTypeDefDir = join(projectDir, 'empty-type-defs')
  await mkdir(emptyTypeDefDir, { recursive: true })
  const { dts: declarationOnly } = await generateTypeDef({
    typeDefDir: emptyTypeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    dtsHeader,
  })
  t.is(countBindingTargetDeclarations(declarationOnly), 1)

  // every route a header reaches the build through
  const headerFile = 'napi-header.d.ts'
  await writeFile(join(projectDir, headerFile), dtsHeader)
  const { dts: fromFile } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    dtsHeaderFile: headerFile,
  })
  t.is(countBindingTargetDeclarations(fromFile), 1)

  const { dts: fromConfig } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    configDtsHeader: dtsHeader,
  })
  t.is(countBindingTargetDeclarations(fromConfig), 1)

  // the WASI flavor file derived from that root declaration keeps the one
  // declaration instead of gaining a second with a conflicting type
  const wasi = ensureBindingTargetDeclaration(
    prepareWasiBindingTypeDef(
      dts,
      join(projectDir, 'index.d.ts'),
      join(projectDir, 'pkg.wasip1.d.cts'),
      false,
    ),
    'wasm32-wasip1',
    dtsHeader,
  )
  t.is(countBindingTargetDeclarations(wasi), 1)
  t.is(bindingTargetDeclarationOf(wasi), headerDeclaration)

  // a header that declares nothing still gains the union
  const { dts: generated, header: defaultHeader } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
  })
  t.is(bindingTargetDeclarationOf(generated), ROOT_BINDING_TARGET_DECLARATION)
  t.is(countBindingTargetDeclarations(generated), 1)
  t.true(defaultHeader.startsWith('/* auto-generated by NAPI-RS */'))

  const { header: headerless } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    noDtsHeader: true,
  })
  t.is(headerless, '')
})

test('a stale generated binding target declaration is refreshed, a custom one is preserved', (t) => {
  const preamble = '/* auto-generated by NAPI-RS */\n'

  // what an earlier version of this branch wrote, before `wasm32-wasip1`
  const stale = `${preamble}
/** The artifact this loader loaded. */
export declare const __napiBindingTarget: 'native' | 'wasm32-wasi'

export declare function sum(a: number, b: number): number
`
  const refreshedRoot = ensureBindingTargetDeclaration(stale)
  t.is(
    bindingTargetDeclarationOf(refreshedRoot),
    ROOT_BINDING_TARGET_DECLARATION,
  )
  t.is(countBindingTargetDeclarations(refreshedRoot), 1)
  // the stale block's doc comment is replaced with it, not stranded above it
  t.false(refreshedRoot.includes('The artifact this loader loaded.'))

  const refreshedFlavor = ensureBindingTargetDeclaration(stale, 'wasm32-wasip1')
  t.is(
    bindingTargetDeclarationOf(refreshedFlavor),
    "export declare const __napiBindingTarget: 'wasm32-wasip1'",
  )
  t.is(countBindingTargetDeclarations(refreshedFlavor), 1)

  // a file kept from a build of the other flavor now types this one
  const wrongFlavor = `${preamble}
/** The WASI flavor this loader instantiates. */
export declare const __napiBindingTarget: 'wasm32-wasi'
`
  t.is(
    bindingTargetDeclarationOf(
      ensureBindingTargetDeclaration(wrongFlavor, 'wasm32-wasip1'),
    ),
    "export declare const __napiBindingTarget: 'wasm32-wasip1'",
  )

  // a type this CLI could never have written belongs to whoever wrote it
  const custom = `${preamble}
export declare const __napiBindingTarget: string
`
  t.is(ensureBindingTargetDeclaration(custom, 'wasm32-wasip1'), custom)
  t.is(ensureBindingTargetDeclaration(custom), custom)

  // and neither is a declaration the build's own header owns, even though it
  // is spelled out of the literals this CLI writes
  const headerOwned = `${preamble}
export declare const __napiBindingTarget: 'native' | 'wasm32-wasi' | 'wasm32-wasip1'
`
  t.is(
    ensureBindingTargetDeclaration(headerOwned, 'wasm32-wasip1', headerOwned),
    headerOwned,
  )

  // refreshing is a fixed point
  t.is(
    ensureBindingTargetDeclaration(refreshedFlavor, 'wasm32-wasip1'),
    refreshedFlavor,
  )
  t.is(ensureBindingTargetDeclaration(refreshedRoot), refreshedRoot)
})

const ROOT_BINDING_TARGET_TYPE = "'native' | 'wasm32-wasi' | 'wasm32-wasip1'"

/**
 * The type of every `__napiBindingTarget` a consumer of `source` can import,
 * in source order, read back with `oxc-parser` — a different parser from the
 * one `build.ts` uses, so these assertions cannot agree with the code by
 * sharing its idea of what a declaration is.
 */
const exportedBindingTargetTypes = (source: string) => {
  const { program } = parseSync('index.d.ts', source)
  const types: string[] = []
  for (const node of program.body) {
    if (
      node.type !== 'ExportNamedDeclaration' ||
      node.declaration?.type !== 'VariableDeclaration'
    ) {
      continue
    }
    for (const declaration of node.declaration.declarations) {
      if (
        declaration.id.type !== 'Identifier' ||
        declaration.id.name !== '__napiBindingTarget'
      ) {
        continue
      }
      const annotation = declaration.id.typeAnnotation
      types.push(
        annotation
          ? source.slice(
              annotation.typeAnnotation.start,
              annotation.typeAnnotation.end,
            )
          : '',
      )
    }
  }
  return types
}

test('a header-owned binding target declaration survives the WASI transforms', async (t) => {
  const { projectDir, typeDefDir } = t.context
  await writeFile(
    join(typeDefDir, 'sum.type'),
    '{"kind":"fn","name":"sum","def":"function sum(a: number, b: number): number"}\n',
  )

  // A header that declares the export itself and imports its own types
  // relatively. `--dts types/index.d.ts` puts the derived `.d.cts` in another
  // directory, so `prepareWasiBindingTypeDef` rebases that specifier and the
  // header stops being a literal prefix of the file derived from it — the
  // declaration it owns must still be recognised as its own.
  const rebasedHeader = `/* auto-generated by NAPI-RS */

import type { Thing } from './thing.js'

${ROOT_BINDING_TARGET_DECLARATION}
export declare function useThing(thing: Thing): void
`
  const { dts: rebasedRoot } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    dtsHeader: rebasedHeader,
  })
  const rebased = ensureBindingTargetDeclaration(
    prepareWasiBindingTypeDef(
      rebasedRoot,
      join(projectDir, 'types', 'index.d.ts'),
      join(projectDir, 'pkg.wasip1.d.cts'),
      false,
    ),
    'wasm32-wasip1',
    rebasedHeader,
  )
  t.true(rebased.includes("from './types/thing.js'"))
  t.deepEqual(exportedBindingTargetTypes(rebased), [ROOT_BINDING_TARGET_TYPE])

  // The threadless flavor drops `node:stream/web` type imports so the DOM
  // globals can take over, which moves the header's declaration just the same.
  const streamHeader = `/* auto-generated by NAPI-RS */

import type { ReadableStream } from 'node:stream/web'

${ROOT_BINDING_TARGET_DECLARATION}
export declare function readAll(stream: ReadableStream): void
`
  const { dts: streamRoot } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    dtsHeader: streamHeader,
  })
  const threadless = ensureBindingTargetDeclaration(
    prepareWasiBindingTypeDef(
      streamRoot,
      join(projectDir, 'index.d.ts'),
      join(projectDir, 'pkg.wasip1.d.cts'),
      false,
    ),
    'wasm32-wasip1',
    streamHeader,
  )
  t.false(threadless.includes('node:stream/web'))
  t.deepEqual(exportedBindingTargetTypes(threadless), [
    ROOT_BINDING_TARGET_TYPE,
  ])
})

test('only a top-level export declares the binding target', async (t) => {
  const { projectDir, typeDefDir } = t.context
  await writeFile(
    join(typeDefDir, 'sum.type'),
    '{"kind":"fn","name":"sum","def":"function sum(a: number, b: number): number"}\n',
  )

  // A commented-out example of the declaration exports nothing, and a member
  // of a `declare namespace` or `declare module` block is an export of that
  // block, not of the file. Taking any of them for the declaration leaves the
  // generated one unwritten and `import { __napiBindingTarget }` at TS2305.
  const headers = {
    'a commented-out example': `/* auto-generated by NAPI-RS */
/* Example:
${ROOT_BINDING_TARGET_DECLARATION}
*/
`,
    'a nested namespace member': `/* auto-generated by NAPI-RS */
declare namespace Legacy {
  export const __napiBindingTarget: string
}
`,
    'a module augmentation member': `/* auto-generated by NAPI-RS */
declare module 'legacy' {
  export const __napiBindingTarget: string
}
`,
  }

  for (const [what, dtsHeader] of Object.entries(headers)) {
    const { dts } = await generateTypeDef({
      typeDefDir,
      cwd: projectDir,
      declareBindingTarget: true,
      dtsHeader,
    })
    t.deepEqual(
      exportedBindingTargetTypes(dts),
      [ROOT_BINDING_TARGET_TYPE],
      `${what} still owes the root declaration`,
    )

    const wasi = ensureBindingTargetDeclaration(
      prepareWasiBindingTypeDef(
        dts,
        join(projectDir, 'index.d.ts'),
        join(projectDir, 'pkg.wasip1.d.cts'),
        false,
      ),
      'wasm32-wasip1',
      dtsHeader,
    )
    t.deepEqual(
      exportedBindingTargetTypes(wasi),
      ["'wasm32-wasip1'"],
      `${what} still owes the flavor declaration`,
    )
    // whatever the header said is left exactly as it wrote it
    t.true(wasi.startsWith(dtsHeader), what)
  }

  // The refresh is held to the same rule: a commented-out example of a
  // declaration this CLI writes is not a declaration to rewrite.
  const commentedStale = `/* auto-generated by NAPI-RS */

/* an earlier build wrote:
export declare const __napiBindingTarget: 'native' | 'wasm32-wasi'
*/

export declare function sum(a: number, b: number): number
`
  const refreshed = ensureBindingTargetDeclaration(
    commentedStale,
    'wasm32-wasip1',
  )
  t.true(refreshed.startsWith(commentedStale))
  t.deepEqual(exportedBindingTargetTypes(refreshed), ["'wasm32-wasip1'"])
})

/**
 * Syntax errors in a generated declaration file, read back with `oxc-parser`.
 * A refresh splices text into a file the CLI did not write all of, so what it
 * leaves behind has to still parse.
 */
const declarationDiagnostics = (source: string) =>
  parseSync('index.d.ts', source).errors.map((error) => error.message)

test('a multi-declarator binding target statement is never rewritten', async (t) => {
  const { projectDir, typeDefDir } = t.context

  // A statement that declares more names than this one is not one this CLI
  // wrote — it never writes a sibling — and the block a refresh replaces spans
  // them, so narrowing it would drop `keepMe` and hand every consumer of that
  // name a TS2305.
  const preserved = `/* auto-generated by NAPI-RS */

export declare const __napiBindingTarget: 'native', keepMe: number

export declare function sum(a: number, b: number): number
`
  t.is(ensureBindingTargetDeclaration(preserved, 'wasm32-wasip1'), preserved)
  t.is(ensureBindingTargetDeclaration(preserved), preserved)
  // it still counts as declared, so nothing is appended beside it either
  t.deepEqual(exportedBindingTargetTypes(preserved), ["'native'"])

  // A header that declares a sibling whose type carries a relative inline
  // import. `prepareWasiBindingTypeDef` rebases that specifier, so the
  // statement stops reading as the header wrote it — the declaration itself
  // still does, which is what decides ownership.
  await writeFile(
    join(typeDefDir, 'sum.type'),
    '{"kind":"fn","name":"sum","def":"function sum(a: number, b: number): number"}\n',
  )
  const dtsHeader = `/* auto-generated by NAPI-RS */

export declare const __napiBindingTarget: ${ROOT_BINDING_TARGET_TYPE},
  thing: import('./thing.js').Thing
`
  const { dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
    dtsHeader,
  })
  const wasi = ensureBindingTargetDeclaration(
    prepareWasiBindingTypeDef(
      dts,
      join(projectDir, 'types', 'index.d.ts'),
      join(projectDir, 'pkg.wasip1.d.cts'),
      false,
    ),
    'wasm32-wasip1',
    dtsHeader,
  )
  t.true(wasi.includes("thing: import('./types/thing.js').Thing"))
  t.deepEqual(exportedBindingTargetTypes(wasi), [ROOT_BINDING_TARGET_TYPE])
  t.deepEqual(declarationDiagnostics(wasi), [])
})

test('a refreshed binding target declaration keeps the statement terminator', (t) => {
  // The replaced span ends past the statement's own `;`, so a replacement that
  // drops it runs whatever followed on the same line into the declaration.
  const sameLine = `/* auto-generated by NAPI-RS */

export declare const __napiBindingTarget: 'native'; export declare function keepMe(): void;
`
  const refreshed = ensureBindingTargetDeclaration(sameLine, 'wasm32-wasip1')
  t.deepEqual(declarationDiagnostics(refreshed), [])
  t.deepEqual(exportedBindingTargetTypes(refreshed), ["'wasm32-wasip1'"])
  t.true(refreshed.includes('export declare function keepMe(): void;'))

  // and a declaration with no doc comment above it keeps its terminator too
  const ownLine = `/* auto-generated by NAPI-RS */

export declare const __napiBindingTarget: 'native';
export declare function keepMe(): void;
`
  const refreshedOwnLine = ensureBindingTargetDeclaration(
    ownLine,
    'wasm32-wasip1',
  )
  t.deepEqual(declarationDiagnostics(refreshedOwnLine), [])
  t.deepEqual(exportedBindingTargetTypes(refreshedOwnLine), ["'wasm32-wasip1'"])
  t.true(
    refreshedOwnLine.includes(
      "/** The WASI flavor this loader instantiates. */\nexport declare const __napiBindingTarget: 'wasm32-wasip1';\n",
    ),
  )
})

test('a WASI flavor without type defs declares its own binding target', async (t) => {
  const { projectDir, typeDefDir } = t.context

  const { dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
    declareBindingTarget: true,
  })

  const prepared = prepareWasiBindingTypeDef(
    dts,
    join(projectDir, 'index.d.ts'),
    join(projectDir, 'pkg.wasip1.d.cts'),
    false,
  )
  t.is(
    bindingTargetDeclarationOf(
      ensureBindingTargetDeclaration(prepared, 'wasm32-wasip1'),
    ),
    "export declare const __napiBindingTarget: 'wasm32-wasip1'",
  )
})

test('the binding target declaration follows the loaders a build emits', (t) => {
  // Each row is a build shape, named by what reaches the CLI. `expected` is
  // whether any loader carrying `__napiBindingTarget` is written for it.
  const shapes = [
    {
      name: 'no --platform, a WASI flavor configured but never built',
      rootLoaderCandidate: false,
      hasWasiFallback: true,
      emitsWasiLoader: false,
      exports: ['sum'],
      expected: false,
    },
    {
      name: 'no --platform, no WASI flavor',
      rootLoaderCandidate: false,
      hasWasiFallback: false,
      emitsWasiLoader: false,
      exports: ['sum'],
      expected: false,
    },
    {
      name: '--platform with a WASI flavor configured',
      rootLoaderCandidate: true,
      hasWasiFallback: true,
      emitsWasiLoader: false,
      exports: ['sum'],
      expected: true,
    },
    {
      name: '--platform --no-js-binding',
      rootLoaderCandidate: false,
      hasWasiFallback: true,
      emitsWasiLoader: false,
      exports: ['sum'],
      expected: false,
    },
    {
      name: '--platform with type defs but zero runtime exports',
      rootLoaderCandidate: true,
      hasWasiFallback: false,
      emitsWasiLoader: false,
      exports: [],
      expected: false,
    },
    {
      name: 'no --platform, zero runtime exports',
      rootLoaderCandidate: false,
      hasWasiFallback: true,
      emitsWasiLoader: false,
      exports: [],
      expected: false,
    },
    {
      name: 'a native build over WASI loaders an earlier build left behind',
      rootLoaderCandidate: true,
      hasWasiFallback: true,
      emitsWasiLoader: true,
      exports: ['sum'],
      expected: true,
    },
    {
      name: '--target wasm32-wasip1 without --platform',
      rootLoaderCandidate: false,
      hasWasiFallback: true,
      emitsWasiLoader: true,
      exports: [],
      expected: true,
    },
    {
      name: 'a plain native-only package',
      rootLoaderCandidate: true,
      hasWasiFallback: false,
      emitsWasiLoader: false,
      exports: ['sum'],
      expected: true,
    },
  ] as const

  for (const shape of shapes) {
    const declares = bindingTargetDeclarationPredicate(shape)
    t.is(declares(shape.exports), shape.expected, shape.name)
  }
})

test('the binding target reservation asks the same predicate as the declaration', (t) => {
  // `Builder.generateTypeDef` reserves `__napiBindingTarget` exactly when it
  // declares it, so the reservation inherits these answers. The predicate reads
  // only the *length* of the export list, never the names in it — which is what
  // lets one decision stand for both.
  const claimed = ['__napiBindingTarget']
  const shapes = [
    {
      name: 'a plain `napi build` reserves nothing',
      rootLoaderCandidate: false,
      hasWasiFallback: false,
      emitsWasiLoader: false,
      exports: claimed,
      expected: false,
    },
    {
      name: '`--platform --no-js` reserves nothing',
      rootLoaderCandidate: false,
      hasWasiFallback: true,
      emitsWasiLoader: false,
      exports: claimed,
      expected: false,
    },
    {
      name: '`--platform` writes a root loader, so the name is reserved',
      rootLoaderCandidate: true,
      hasWasiFallback: false,
      emitsWasiLoader: false,
      exports: claimed,
      expected: true,
    },
    {
      name: 'a regenerated WASI loader set reserves the name on its own',
      rootLoaderCandidate: false,
      hasWasiFallback: false,
      emitsWasiLoader: true,
      exports: [],
      expected: true,
    },
  ] as const

  for (const shape of shapes) {
    t.is(
      bindingTargetDeclarationPredicate(shape)(shape.exports),
      shape.expected,
      shape.name,
    )
  }
})

test('resolveBuildFormat handles defaults, aliases, and conflicts', (t) => {
  const validCases = [
    { options: {}, expected: 'commonjs' },
    { options: { format: 'esm' }, expected: 'esm' },
    { options: { format: 'commonjs' }, expected: 'commonjs' },
    { options: { esm: true }, expected: 'esm' },
    { options: { commonjs: true }, expected: 'commonjs' },
  ] as const

  for (const { options, expected } of validCases) {
    t.is(resolveBuildFormat(options), expected)
  }

  const invalidCases = [
    {
      options: { esm: true, commonjs: true },
      message: /`--esm` and `--commonjs` cannot be used together/,
    },
    {
      options: { format: 'esm', commonjs: true },
      message: /`--format esm` cannot be used with `--commonjs`/,
    },
    {
      options: { format: 'commonjs', esm: true },
      message: /`--format commonjs` cannot be used with `--esm`/,
    },
    {
      options: { format: 'invalid' },
      message: /Invalid build format "invalid"/,
    },
    {
      options: { format: '' },
      message: /Invalid build format ""/,
    },
  ] as const

  for (const { options, message } of invalidCases) {
    t.throws(() => resolveBuildFormat(options), { message })
  }
})

const ASYNC_RUNTIME_HOST_EXPORTS = [
  'getCurrentThreadTaskHostContractVersion',
  'isCurrentThreadHostRegistrationActive',
  'registerCurrentThreadTaskHost',
  'registerTimerHost',
  'reserveCurrentThreadHostRegistration',
  'unregisterCurrentThreadTaskHost',
  'unregisterTimerHost',
]

test('checkAsyncRuntimeHostContract reports the exports a binding is missing', (t) => {
  const { error, warning } = checkAsyncRuntimeHostContract({
    idents: ['plus100', 'registerTimerHost'],
    asyncRuntime: true,
    typeDefAvailable: true,
    packageName: 'missing-host-exports',
  })

  t.is(warning, undefined)
  t.truthy(error)
  t.regex(error!, /missing-host-exports/)
  for (const name of ASYNC_RUNTIME_HOST_EXPORTS) {
    if (name === 'registerTimerHost') {
      t.notRegex(error!, new RegExp(`Missing:[^.]*\\b${name}\\b`))
    } else {
      t.regex(error!, new RegExp(`Missing:[^.]*\\b${name}\\b`))
    }
  }
})

test('checkAsyncRuntimeHostContract warns when the contract is exported but the flag is off', (t) => {
  const { error, warning } = checkAsyncRuntimeHostContract({
    idents: [...ASYNC_RUNTIME_HOST_EXPORTS, 'plus100'],
    asyncRuntime: false,
    typeDefAvailable: true,
    packageName: 'flag-is-off',
  })

  t.is(error, undefined)
  t.truthy(warning)
  t.regex(warning!, /napi\.wasm\.asyncRuntime is not enabled/)
})

test('checkAsyncRuntimeHostContract skips the check without type-def metadata', (t) => {
  const { error, warning } = checkAsyncRuntimeHostContract({
    idents: [],
    asyncRuntime: true,
    typeDefAvailable: false,
    packageName: 'no-type-def',
  })

  t.is(error, undefined)
  t.truthy(warning)
  t.regex(warning!, /type-def/)
  t.regex(warning!, /ERR_NAPI_ASYNC_RUNTIME_BINDING_MISMATCH/)

  t.deepEqual(
    checkAsyncRuntimeHostContract({
      idents: [],
      asyncRuntime: false,
      typeDefAvailable: false,
      packageName: 'no-type-def',
    }),
    {},
  )
})

test('checkAsyncRuntimeHostContract stays silent when the flag matches the exports', (t) => {
  t.deepEqual(
    checkAsyncRuntimeHostContract({
      idents: [...ASYNC_RUNTIME_HOST_EXPORTS, 'plus100'],
      asyncRuntime: true,
      typeDefAvailable: true,
      packageName: 'all-good',
    }),
    {},
  )

  t.deepEqual(
    checkAsyncRuntimeHostContract({
      idents: ['plus100'],
      asyncRuntime: false,
      typeDefAvailable: true,
      packageName: 'all-good',
    }),
    {},
  )
})

test('generateTypeDef preserves deterministic file order', async (t) => {
  const { projectDir, typeDefDir } = t.context

  await mkdir(join(typeDefDir, 'nested'), { recursive: true })
  await writeFile(
    join(typeDefDir, 'b.type'),
    '{"kind":"fn","name":"zeta","def":"function zeta(): void"}\n',
  )
  await writeFile(
    join(typeDefDir, 'a.type'),
    '{"kind":"fn","name":"alpha","def":"function alpha(): void"}\n',
  )

  const { exports, dts } = await generateTypeDef({
    typeDefDir,
    cwd: projectDir,
  })

  t.deepEqual(exports, ['alpha', 'zeta'])
  t.true(
    dts.indexOf('function alpha(): void') <
      dts.indexOf('function zeta(): void'),
  )
})

test('should throw on emnapi version mismatch in wasm build', async (t) => {
  const { projectDir } = t.context
  const crateName = 'wasm_version_check'
  const binaryName = 'wasm-version-check'
  const packageName = 'wasm-version-check'
  const version = '0.1.0'

  const napiPath = posixJoin(repoRoot, 'crates', 'napi').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiDerivePath = posixJoin(repoRoot, 'crates', 'macro').replaceAll(
    win32Sep,
    posixSep,
  )
  const napiBuildPath = posixJoin(repoRoot, 'crates', 'build').replaceAll(
    win32Sep,
    posixSep,
  )

  await mkdir(join(projectDir, 'src'), { recursive: true })

  const cargoToml = `[package]
name = "${crateName}"
version = "${version}"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { path = "${napiPath}", features = ["noop"] }
napi-derive = { path = "${napiDerivePath}", features = ["noop"] }

[build-dependencies]
napi-build = { path = "${napiBuildPath}" }
`

  await writeFile(join(projectDir, 'Cargo.toml'), cargoToml)
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        napi: {
          binaryName,
          targets: ['wasm32-wasi-preview1-threads'],
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(projectDir, 'build.rs'),
    'fn main() {\n    napi_build::setup();\n}\n',
  )
  await writeFile(
    join(projectDir, 'src', 'lib.rs'),
    'use napi_derive::napi;\n\n#[napi]\npub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
  )

  // Create fake @emnapi/core and @emnapi/runtime with mismatched versions
  const fakeVersion = '0.0.0-fake'
  for (const pkg of ['@emnapi/core', '@emnapi/runtime']) {
    const pkgDir = join(projectDir, 'node_modules', pkg)
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: pkg, version: fakeVersion, main: 'index.js' }),
    )
    await writeFile(
      join(pkgDir, 'index.js'),
      `module.exports = { version: "${fakeVersion}" }`,
    )
  }

  const error = await t.throwsAsync(() =>
    buildProject({
      target: 'wasm32-wasi-preview1-threads',
      cwd: projectDir,
    }),
  )

  t.truthy(error)
  t.regex(error!.message, /emnapi version mismatch/)
})

test('validateCrossCompileFlags rejects combining two cross-compilation mechanisms', (t) => {
  t.throws(
    () => validateCrossCompileFlags({ useCross: true, crossCompile: true }),
    { message: /`--use-cross`.+`--cross-compile`.+cannot be used together/ },
  )
  t.throws(
    () => validateCrossCompileFlags({ useCross: true, useNapiCross: true }),
    { message: /`--use-cross`.+`--use-napi-cross`.+cannot be used together/ },
  )
  t.throws(
    () => validateCrossCompileFlags({ useNapiCross: true, crossCompile: true }),
    {
      message: /`--use-napi-cross`.+`--cross-compile`.+cannot be used together/,
    },
  )
  t.throws(
    () =>
      validateCrossCompileFlags({
        useCross: true,
        useNapiCross: true,
        crossCompile: true,
      }),
    {
      message:
        /`--use-cross`.+`--use-napi-cross`.+`--cross-compile`.+cannot be used together/,
    },
  )
})

test('validateCrossCompileFlags allows a single cross-compilation mechanism', (t) => {
  t.notThrows(() => validateCrossCompileFlags({}))
  t.notThrows(() => validateCrossCompileFlags({ useCross: true }))
  t.notThrows(() => validateCrossCompileFlags({ crossCompile: true }))
  t.notThrows(() => validateCrossCompileFlags({ useNapiCross: true }))
})

test('validateCrossCompileFlags rejects windows-gnu targets with `--cross-compile`', (t) => {
  const windowsGnuError =
    /`--cross-compile` \(`-x`\) does not support the target x86_64-pc-windows-gnu/
  // `cargo-xwin` is only used on non-Windows hosts, where it silently
  // no-ops for `windows-gnu` targets, so the combination must be rejected.
  const gnuError = t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
        'linux',
      ),
    { message: windowsGnuError },
  )
  // `windows-gnu` links with a mingw-w64 GCC toolchain.
  t.regex(gnuError!.message, /x86_64-w64-mingw32-gcc/)
  t.regex(gnuError!.message, /LIBNODE_PATH/)
  t.regex(gnuError!.message, /x86_64-pc-windows-msvc/)
  t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
        'darwin',
      ),
    { message: windowsGnuError },
  )
  // `gnullvm`-flavored triples take the same broken `cargo-xwin` route, but
  // link with an LLVM toolchain (llvm-mingw), not the mingw-w64 GCC one.
  const gnullvmError = t.throws(
    () =>
      validateCrossCompileFlags(
        { crossCompile: true, target: 'x86_64-pc-windows-gnullvm' },
        'linux',
      ),
    {
      message:
        /`--cross-compile` \(`-x`\) does not support the target x86_64-pc-windows-gnullvm/,
    },
  )
  t.regex(gnullvmError!.message, /llvm-mingw/)
  t.notRegex(gnullvmError!.message, /mingw32-gcc/)
  t.regex(gnullvmError!.message, /LIBNODE_PATH/)
  t.regex(gnullvmError!.message, /x86_64-pc-windows-msvc/)
  // The target can also come from `CARGO_BUILD_TARGET`; the check is fully
  // synchronous, so the environment is mutated and restored without any
  // interleaving point another concurrently running test could observe.
  const originalCargoBuildTarget = process.env.CARGO_BUILD_TARGET
  try {
    process.env.CARGO_BUILD_TARGET = 'x86_64-pc-windows-gnu'
    t.throws(() => validateCrossCompileFlags({ crossCompile: true }, 'linux'), {
      message: windowsGnuError,
    })
  } finally {
    if (originalCargoBuildTarget === undefined) {
      delete process.env.CARGO_BUILD_TARGET
    } else {
      process.env.CARGO_BUILD_TARGET = originalCargoBuildTarget
    }
  }
})

test('validateCrossCompileFlags allows `--cross-compile` for non windows-gnu targets', (t) => {
  // MSVC targets are exactly what `cargo-xwin` supports.
  for (const target of [
    'x86_64-pc-windows-msvc',
    'aarch64-pc-windows-msvc',
    'i686-pc-windows-msvc',
    'x86_64-unknown-linux-gnu',
    'aarch64-apple-darwin',
  ]) {
    t.notThrows(() =>
      validateCrossCompileFlags({ crossCompile: true, target }, 'linux'),
    )
  }
  // On a Windows host `--cross-compile` never routes through `cargo-xwin`
  // (it falls back to a plain `cargo build`), so windows-gnu stays allowed.
  t.notThrows(() =>
    validateCrossCompileFlags(
      { crossCompile: true, target: 'x86_64-pc-windows-gnu' },
      'win32',
    ),
  )
  // Without `--cross-compile` the target is none of this check's business.
  t.notThrows(() =>
    validateCrossCompileFlags({ target: 'x86_64-pc-windows-gnu' }, 'linux'),
  )
})

test('validateCrossCompileFlags rejects watch mode combined with cross builds', (t) => {
  t.throws(() => validateCrossCompileFlags({ watch: true, useCross: true }), {
    message: /`--watch` cannot be used with `--use-cross`/,
  })
  t.throws(
    () => validateCrossCompileFlags({ watch: true, crossCompile: true }),
    { message: /`--watch` cannot be used with `--cross-compile`/ },
  )
  t.notThrows(() => validateCrossCompileFlags({ watch: true }))
  t.notThrows(() =>
    validateCrossCompileFlags({ watch: true, useNapiCross: true }),
  )
})

test('validateNapiCrossSupport rejects unsupported hosts', (t) => {
  t.throws(
    () =>
      validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'darwin', 'arm64'),
    { message: /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/ },
  )
  t.throws(
    () => validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'win32', 'x64'),
    { message: /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/ },
  )
  t.throws(
    () =>
      validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'linux', 'ia32'),
    { message: /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/ },
  )
  t.notThrows(() =>
    validateNapiCrossSupport('aarch64-unknown-linux-gnu', 'linux', 'x64'),
  )
  t.notThrows(() =>
    validateNapiCrossSupport('x86_64-unknown-linux-gnu', 'linux', 'arm64'),
  )
})

test('validateNapiCrossSupport rejects unsupported target triples', (t) => {
  t.throws(
    () => validateNapiCrossSupport('x86_64-unknown-linux-musl', 'linux', 'x64'),
    {
      message:
        /`--use-napi-cross` does not support the target x86_64-unknown-linux-musl/,
    },
  )
  t.throws(
    () =>
      validateNapiCrossSupport('riscv64gc-unknown-linux-gnu', 'linux', 'arm64'),
    {
      message:
        /`--use-napi-cross` does not support the target riscv64gc-unknown-linux-gnu/,
    },
  )
  for (const triple of [
    'x86_64-unknown-linux-gnu',
    'aarch64-unknown-linux-gnu',
    'armv7-unknown-linux-gnueabihf',
    's390x-unknown-linux-gnu',
    'powerpc64le-unknown-linux-gnu',
  ]) {
    t.notThrows(() => validateNapiCrossSupport(triple, 'linux', 'x64'))
    t.notThrows(() => validateNapiCrossSupport(triple, 'linux', 'arm64'))
  }
})

const napiCrossToolchainPath = posixJoin(
  '/home/user/.napi-rs/cross-toolchain/1.0.0',
  'aarch64-unknown-linux-gnu',
)
const napiCrossDownloadedSysroot = join(
  napiCrossToolchainPath,
  'aarch64-unknown-linux-gnu',
  'sysroot',
)

test('napiCrossToolchainEnvs points the build at the downloaded toolchain', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin' },
  )

  t.is(
    envs.CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER,
    join(napiCrossToolchainPath, 'bin', 'aarch64-unknown-linux-gnu-gcc'),
  )
  t.is(envs.TARGET_SYSROOT, napiCrossDownloadedSysroot)
  t.is(envs.BINDGEN_EXTRA_CLANG_ARGS, `--sysroot=${napiCrossDownloadedSysroot}`)
  t.is(envs.PATH, `${napiCrossToolchainPath}/bin:/usr/bin`)
  // gcc is the default compiler, so no clang-specific flags are set.
  t.is(envs.TARGET_CFLAGS, undefined)
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs respects a user-provided TARGET_SYSROOT', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_SYSROOT: '/opt/custom-sysroot' },
  )

  // The user's value wins: it is not overridden...
  t.is(envs.TARGET_SYSROOT, undefined)
  // ...and the derived flags use it.
  t.is(envs.BINDGEN_EXTRA_CLANG_ARGS, '--sysroot=/opt/custom-sysroot')
})

test('napiCrossToolchainEnvs treats an empty TARGET_SYSROOT as unset', (t) => {
  // `setEnvIfNotExists` uses falsy semantics (`!process.env[env]`), so a
  // present-but-empty `TARGET_SYSROOT` still gets the downloaded sysroot
  // written to the build environment — the flags derived from the effective
  // sysroot must follow the same rule instead of producing `--sysroot=`.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_SYSROOT: '' },
  )

  t.is(envs.TARGET_SYSROOT, napiCrossDownloadedSysroot)
  t.is(envs.BINDGEN_EXTRA_CLANG_ARGS, `--sysroot=${napiCrossDownloadedSysroot}`)
})

test('napiCrossToolchainEnvs derives clang flags from the effective sysroot', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    {
      PATH: '/usr/bin',
      // Present-but-empty values must fall back to the downloaded sysroot.
      TARGET_SYSROOT: '',
      TARGET_CC: 'clang',
      TARGET_CXX: 'clang++',
      TARGET_CFLAGS: '-O2',
    },
  )

  t.is(
    envs.TARGET_CFLAGS,
    `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} -O2`,
  )
  t.is(
    envs.TARGET_CXXFLAGS,
    `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `,
  )
})

test('napiCrossToolchainEnvs sets a bare toolchain PATH when the env has none', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    {},
  )

  // No `:undefined` tail when the provided env has no PATH at all.
  t.is(envs.PATH, `${napiCrossToolchainPath}/bin`)
})

test('napiCrossToolchainEnvs recognizes path-qualified, prefixed and versioned clang', (t) => {
  const clangFlags = `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `

  for (const [cc, cxx] of [
    ['/usr/bin/clang', '/opt/llvm/bin/clang++'],
    ['aarch64-linux-gnu-clang', 'aarch64-linux-gnu-clang++'],
    ['clang-18', 'clang++-18'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, clangFlags, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, clangFlags, `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs ignores CC/CXX when the toolchain compiler is effective', (t) => {
  // With TARGET_CC/TARGET_CXX unset, the function itself exports the
  // toolchain gcc/g++ as TARGET_CC/TARGET_CXX — and cc-rs prefers TARGET_CC
  // over CC for cross builds, so a clang in CC/CXX never actually runs.
  // Injecting the clang-only `--gcc-toolchain=` flag here would hard-error
  // the gcc that does run.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', CC: '/usr/bin/clang', CXX: '/opt/llvm/bin/clang++' },
  )

  t.true(envs.TARGET_CC.endsWith('-gcc'))
  t.true(envs.TARGET_CXX.endsWith('-g++'))
  t.is(envs.TARGET_CFLAGS, undefined)
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs treats an empty TARGET_CC as unset for clang detection', (t) => {
  // Falsy semantics: a present-but-empty TARGET_CC still gets the toolchain
  // gcc written to the build environment, so the CC fallback must not
  // resurrect clang detection for a compiler that will not run.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_CC: '', CC: '/usr/bin/clang' },
  )

  t.is(
    envs.TARGET_CC,
    join(napiCrossToolchainPath, 'bin', 'aarch64-unknown-linux-gnu-gcc'),
  )
  t.is(envs.TARGET_CFLAGS, undefined)
})

test('napiCrossToolchainEnvs lets a user TARGET_CC=clang win over CC=gcc', (t) => {
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_CC: 'clang', CC: 'gcc' },
  )

  t.is(
    envs.TARGET_CFLAGS,
    `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `,
  )
  // The CXX side is untouched, so it stays on the toolchain g++ without
  // clang flags — each language is detected independently.
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs injects no flags on either side when only CC=clang is set', (t) => {
  // Both languages default to the toolchain gcc/g++; neither effective
  // compiler is clang, so neither flag set is injected.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', CC: 'clang' },
  )

  t.true(envs.TARGET_CC.endsWith('-gcc'))
  t.is(envs.TARGET_CFLAGS, undefined)
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs does not mistake non-clang tools for clang', (t) => {
  for (const [cc, cxx] of [
    ['gcc', 'g++'],
    ['x86_64-unknown-linux-gnu-gcc', 'x86_64-unknown-linux-gnu-g++'],
    // `clang-format` is a clang-family tool but not a compiler.
    ['clang-format', 'clang-format'],
    ['someclangthing', 'someclangthing'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, undefined, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, undefined, `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs detects clang behind cc-rs wrapper and argument forms', (t) => {
  const clangFlags = `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `

  // cc-rs parses the env value before executing it (`env_tool`): the value
  // is split on whitespace, a known wrapper prefix (`sccache clang`) runs
  // the second token, and an argument form (`clang -target …`) runs the
  // first token with the rest as arguments — clang runs in both cases.
  for (const [cc, cxx] of [
    ['sccache clang', 'sccache clang++'],
    ['ccache clang-18', 'ccache clang++-18'],
    ['distcc /usr/bin/clang', 'distcc /usr/bin/clang++'],
    [
      'clang -target aarch64-unknown-linux-gnu',
      'clang++ -target aarch64-unknown-linux-gnu',
    ],
    ['/usr/bin/clang --sysroot=/x', '/usr/bin/clang++ --sysroot=/x'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, clangFlags, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, clangFlags, `TARGET_CXX=${cxx}`)
  }
})

// Writes empty files at `relativePaths` under a fresh temp directory whose
// subdirectories contain spaces, mirroring installs like `/opt/LLVM 18`.
// Returns the temp directory root; removal is registered on `t.teardown`.
const makeCompilerFixture = (
  t: ExecutionContext,
  relativePaths: Array<string>,
): string => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'napi-clang-detect-'))
  t.teardown(() => rmSync(fixtureRoot, { recursive: true, force: true }))
  for (const relativePath of relativePaths) {
    const absolutePath = join(fixtureRoot, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, '')
  }
  return fixtureRoot
}

test('napiCrossToolchainEnvs matches clang in space-containing paths that exist on disk', (t) => {
  const clangFlags = `--sysroot=${napiCrossDownloadedSysroot} --gcc-toolchain=${napiCrossToolchainPath} `

  // cc-rs's `env_tool` treats the WHOLE env value as the compiler when it
  // exists on the filesystem (`check_exe`) before any whitespace splitting,
  // so `TARGET_CC="<tmp>/LLVM 18/bin/clang"` runs clang — splitting it into
  // `<tmp>/LLVM` + `18/bin/clang` would miss the clang detection entirely.
  const fixtureRoot = makeCompilerFixture(t, [
    'LLVM 18/bin/clang',
    'LLVM 18/bin/clang++-17',
  ])
  const cc = join(fixtureRoot, 'LLVM 18', 'bin', 'clang')
  const cxx = join(fixtureRoot, 'LLVM 18', 'bin', 'clang++-17')
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
  )

  t.is(envs.TARGET_CFLAGS, clangFlags, `TARGET_CC=${cc}`)
  t.is(envs.TARGET_CXXFLAGS, clangFlags, `TARGET_CXX=${cxx}`)
})

test('napiCrossToolchainEnvs does not mistake existing space-containing non-clang paths for clang', (t) => {
  const fixtureRoot = makeCompilerFixture(t, [
    'app dir/bin/gcc',
    'app dir/bin/g++',
    // A clang-family tool that is not a compiler, in a space-containing path.
    'LLVM 18/bin/clang-format',
  ])
  for (const [cc, cxx] of [
    [
      join(fixtureRoot, 'app dir', 'bin', 'gcc'),
      join(fixtureRoot, 'app dir', 'bin', 'g++'),
    ],
    [
      join(fixtureRoot, 'LLVM 18', 'bin', 'clang-format'),
      join(fixtureRoot, 'LLVM 18', 'bin', 'clang-format'),
    ],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, undefined, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, undefined, `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs splits space-containing paths that do not exist on disk', (t) => {
  // cc-rs only takes the whole value as a compiler path when it exists on
  // the filesystem; otherwise it splits on whitespace, so this value runs
  // `/nonexistent` with `dir/bin/clang` as an argument — never clang.
  const envs = napiCrossToolchainEnvs(
    napiCrossToolchainPath,
    'aarch64-unknown-linux-gnu',
    {
      PATH: '/usr/bin',
      TARGET_CC: '/nonexistent dir/bin/clang',
      TARGET_CXX: '/nonexistent dir/bin/clang++',
    },
  )

  t.is(envs.TARGET_CFLAGS, undefined)
  t.is(envs.TARGET_CXXFLAGS, undefined)
})

test('napiCrossToolchainEnvs does not mistake gcc with clang-ending arguments for clang', (t) => {
  // The basename of each WHOLE value below is `clang`, but none of them
  // exists as a file, so cc-rs splits on whitespace and runs gcc — clang
  // flags injected here would hard-error the gcc compile.
  for (const [cc, cxx] of [
    ['gcc --sysroot=/opt/clang', 'g++ --sysroot=/opt/clang'],
    ['gcc -B/opt/LLVM 18/bin/clang', 'g++ -B/opt/LLVM 18/bin/clang'],
    ['sccache gcc --sysroot=/opt/clang', 'sccache g++ --sysroot=/opt/clang'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, undefined, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, undefined, `TARGET_CXX=${cxx}`)
  }
})

test('napiCrossToolchainEnvs does not mistake wrapped or argument-form non-clang for clang', (t) => {
  for (const [cc, cxx] of [
    ['sccache gcc', 'sccache g++'],
    ['ccache gcc', 'ccache g++'],
    ['gcc -B/foo', 'g++ -B/foo'],
    // The compiler token behind the wrapper is still not a compiler.
    ['sccache clang-format', 'sccache clang-format'],
  ]) {
    const envs = napiCrossToolchainEnvs(
      napiCrossToolchainPath,
      'aarch64-unknown-linux-gnu',
      { PATH: '/usr/bin', TARGET_CC: cc, TARGET_CXX: cxx },
    )

    t.is(envs.TARGET_CFLAGS, undefined, `TARGET_CC=${cc}`)
    t.is(envs.TARGET_CXXFLAGS, undefined, `TARGET_CXX=${cxx}`)
  }
})

test('buildProject rejects invalid cross flag combinations upfront', async (t) => {
  const { projectDir } = t.context

  await mkdir(join(projectDir, 'src'), { recursive: true })
  await writeFile(
    join(projectDir, 'Cargo.toml'),
    `[package]
name = "cross_flags_check"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]
`,
  )
  await writeFile(join(projectDir, 'src', 'lib.rs'), '')
  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'cross-flags-check',
        version: '0.1.0',
        napi: { binaryName: 'cross-flags-check' },
      },
      null,
      2,
    )}\n`,
  )

  const comboError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, useCross: true, crossCompile: true }),
  )
  t.regex(comboError!.message, /cannot be used together/)

  const watchError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, watch: true, crossCompile: true }),
  )
  t.regex(
    watchError!.message,
    /`--watch` cannot be used with `--cross-compile`/,
  )

  const napiCrossError = await t.throwsAsync(() =>
    buildProject({
      cwd: projectDir,
      useNapiCross: true,
      target: 'riscv64gc-unknown-linux-gnu',
    }),
  )
  t.regex(napiCrossError!.message, /`--use-napi-cross`/)
})

test('buildProject validates cross flags before resolving the crate manifest', async (t) => {
  // `projectDir` deliberately contains no `Cargo.toml`: if `buildProject`
  // resolved the manifest (and spawned `cargo metadata`) before validating
  // the cross-compilation flags, these calls would fail with
  // "No crate found in manifest" instead of the validation errors below.
  const { projectDir } = t.context

  const comboError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, useCross: true, crossCompile: true }),
  )
  t.regex(
    comboError!.message,
    /`--use-cross`.+`--cross-compile`.+cannot be used together/,
  )

  const watchError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, watch: true, useCross: true }),
  )
  t.regex(watchError!.message, /`--watch` cannot be used with `--use-cross`/)

  const watchCrossCompileError = await t.throwsAsync(() =>
    buildProject({ cwd: projectDir, watch: true, crossCompile: true }),
  )
  t.regex(
    watchCrossCompileError!.message,
    /`--watch` cannot be used with `--cross-compile`/,
  )

  // Rejected either for the unsupported host (non Linux x64/arm64) or for
  // the unsupported target triple (on Linux x64/arm64 hosts) — both are
  // `--use-napi-cross` validation errors, keeping this assertion
  // host-platform independent.
  const napiCrossError = await t.throwsAsync(() =>
    buildProject({
      cwd: projectDir,
      useNapiCross: true,
      target: 'riscv64gc-unknown-linux-gnu',
    }),
  )
  t.regex(napiCrossError!.message, /`--use-napi-cross`/)
})

// On a Windows host `--cross-compile` never routes through `cargo-xwin`,
// so the windows-gnu rejection only exists on non-Windows hosts.
;(process.platform === 'win32' ? test.skip : test)(
  'buildProject rejects `--cross-compile` with a windows-gnu target before any side effect',
  async (t) => {
    // `projectDir` deliberately contains no `Cargo.toml`: if `buildProject`
    // resolved the manifest (and spawned `cargo metadata`) before validating
    // the target, this call would fail with a manifest error instead of the
    // windows-gnu validation error below.
    const { projectDir } = t.context

    const error = await t.throwsAsync(() =>
      buildProject({
        cwd: projectDir,
        crossCompile: true,
        target: 'x86_64-pc-windows-gnu',
      }),
    )
    t.regex(
      error!.message,
      /`--cross-compile` \(`-x`\) does not support the target x86_64-pc-windows-gnu/,
    )
    t.regex(error!.message, /cargo-xwin/)
  },
)

// The scenario below only exists on hosts `--use-napi-cross` does not
// support (anything but Linux x64 / Linux arm64), so skip it elsewhere.
const isNapiCrossUnsupportedHost =
  process.platform !== 'linux' ||
  (process.arch !== 'x64' && process.arch !== 'arm64')

;(isNapiCrossUnsupportedHost ? test : test.skip)(
  'buildProject reports the `--use-napi-cross` host error before resolving the target',
  async (t) => {
    const { projectDir } = t.context

    // Without an explicit `--target` (or `CARGO_BUILD_TARGET`), resolving
    // the target spawns `rustc -vV`. Point `PATH` at an empty directory so
    // that spawn is guaranteed to fail — whether or not Rust is installed on
    // this machine: if `buildProject` resolved the target before validating
    // the host, the error below would be the `rustc` spawn failure instead
    // of the host validation error.
    const emptyPathDir = join(projectDir, 'empty-path')
    await mkdir(emptyPathDir, { recursive: true })

    const originalPath = process.env.PATH
    const originalCargoBuildTarget = process.env.CARGO_BUILD_TARGET
    process.env.PATH = emptyPathDir
    delete process.env.CARGO_BUILD_TARGET
    // The cross-flag validation runs synchronously at the top of
    // `buildProject`, so the promise below is already settled (rejected)
    // when the environment is restored right after — no other concurrently
    // running test can observe the modified `PATH`.
    let buildPromise: Promise<unknown>
    try {
      buildPromise = buildProject({ cwd: projectDir, useNapiCross: true })
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = originalPath
      }
      if (originalCargoBuildTarget === undefined) {
        delete process.env.CARGO_BUILD_TARGET
      } else {
        process.env.CARGO_BUILD_TARGET = originalCargoBuildTarget
      }
    }

    const error = await t.throwsAsync(() => buildPromise)
    t.regex(
      error!.message,
      /`--use-napi-cross` requires a Linux x64 or Linux arm64 host/,
    )
  },
)

async function createEmnapiLibDir(root: string, dirNames: string[]) {
  const emnapiLibDir = join(root, 'emnapi', 'lib')
  for (const dirName of dirNames) {
    await mkdir(join(emnapiLibDir, dirName), { recursive: true })
  }
  return emnapiLibDir
}

async function createWasiSdkDir(root: string, version: string) {
  const wasiSdkPath = join(root, `wasi-sdk-${version}`)
  await mkdir(wasiSdkPath, { recursive: true })
  await writeFile(join(wasiSdkPath, 'VERSION'), `${version}\n`)
  return wasiSdkPath
}

async function createWasiLibcArchive(
  projectDir: string,
  abi: 'legacy' | 'new',
) {
  const libcPath = join(projectDir, `libc-${abi}.a`)
  // Only the archive member names matter: wasi-libc moved the futex helpers
  // into `futex.c` when it dropped the `int op` parameter, and kept `__wait.c`
  // for other symbols.
  const members =
    abi === 'new'
      ? ['__wait.c.obj', 'futex.c.obj']
      : ['__wait.c.obj', '__wasilibc_busywait.c.obj']
  await writeFile(libcPath, `!<arch>\n${members.join('\n')}\n`)
  return libcPath
}

test('selects the wasi-sdk 34 emnapi archives for wasi-sdk >= 34', async (t) => {
  const { projectDir } = t.context
  const emnapiLibDir = await createEmnapiLibDir(projectDir, [
    'wasm32-wasip1',
    'wasm32-wasip1-threads',
    EMNAPI_WASI_SDK_34_LINK_DIR,
  ])
  const wasiSdkPath = await createWasiSdkDir(projectDir, '34.0')

  t.deepEqual(
    selectEmnapiLinkDir(
      emnapiLibDir,
      'wasm32-wasip1-threads',
      true,
      wasiSdkPath,
    ),
    {
      linkDirName: EMNAPI_WASI_SDK_34_LINK_DIR,
      wasiSdkMajor: 34,
      needsWasiSdk34: true,
    },
  )
})

test('keeps the legacy emnapi archives for wasi-sdk <= 33', async (t) => {
  const { projectDir } = t.context
  const emnapiLibDir = await createEmnapiLibDir(projectDir, [
    'wasm32-wasip1-threads',
    EMNAPI_WASI_SDK_34_LINK_DIR,
  ])
  const wasiSdkPath = await createWasiSdkDir(projectDir, '33.0')

  t.deepEqual(
    selectEmnapiLinkDir(
      emnapiLibDir,
      'wasm32-wasip1-threads',
      true,
      wasiSdkPath,
    ),
    {
      linkDirName: 'wasm32-wasip1-threads',
      wasiSdkMajor: 33,
      needsWasiSdk34: false,
    },
  )
})

test('keeps the legacy emnapi archives when the wasi-libc ABI is unknown', async (t) => {
  const { projectDir } = t.context
  const emnapiLibDir = await createEmnapiLibDir(projectDir, [
    'wasm32-wasip1-threads',
    EMNAPI_WASI_SDK_34_LINK_DIR,
  ])

  t.deepEqual(
    // `null` stands in for a Rust sysroot that cannot be probed.
    selectEmnapiLinkDir(
      emnapiLibDir,
      'wasm32-wasip1-threads',
      true,
      undefined,
      { rustWasiLibc: null },
    ),
    {
      linkDirName: 'wasm32-wasip1-threads',
      wasiSdkMajor: null,
      needsWasiSdk34: false,
    },
  )
})

test('keeps the legacy emnapi archives for a pre wasi-sdk 34 Rust toolchain', async (t) => {
  const { projectDir } = t.context
  const emnapiLibDir = await createEmnapiLibDir(projectDir, [
    'wasm32-wasip1-threads',
    EMNAPI_WASI_SDK_34_LINK_DIR,
  ])
  const rustWasiLibc = await createWasiLibcArchive(projectDir, 'legacy')

  t.deepEqual(
    selectEmnapiLinkDir(
      emnapiLibDir,
      'wasm32-wasip1-threads',
      true,
      undefined,
      { rustWasiLibc },
    ),
    {
      linkDirName: 'wasm32-wasip1-threads',
      wasiSdkMajor: null,
      needsWasiSdk34: false,
    },
  )
})

test('selects the wasi-sdk 34 archives for a Rust toolchain that bundles the new wasi-libc', async (t) => {
  const { projectDir } = t.context
  const emnapiLibDir = await createEmnapiLibDir(projectDir, [
    'wasm32-wasip1-threads',
    EMNAPI_WASI_SDK_34_LINK_DIR,
  ])
  const rustWasiLibc = await createWasiLibcArchive(projectDir, 'new')

  t.deepEqual(
    // No wasi-sdk is configured: cargo links Rust's bundled wasi-libc, and
    // Rust picked up wasi-sdk 34 in rust-lang/rust#161773.
    selectEmnapiLinkDir(
      emnapiLibDir,
      'wasm32-wasip1-threads',
      true,
      undefined,
      { rustWasiLibc },
    ),
    {
      linkDirName: EMNAPI_WASI_SDK_34_LINK_DIR,
      wasiSdkMajor: null,
      needsWasiSdk34: true,
    },
  )
})

test('never selects the wasi-sdk 34 archives for the threadless target', async (t) => {
  const { projectDir } = t.context
  const emnapiLibDir = await createEmnapiLibDir(projectDir, [
    'wasm32-wasip1',
    EMNAPI_WASI_SDK_34_LINK_DIR,
  ])
  const wasiSdkPath = await createWasiSdkDir(projectDir, '34.0')

  t.deepEqual(
    selectEmnapiLinkDir(emnapiLibDir, 'wasm32-wasip1', false, wasiSdkPath),
    {
      linkDirName: 'wasm32-wasip1',
      wasiSdkMajor: 34,
      needsWasiSdk34: false,
    },
  )
})

test('falls back to the legacy archives when emnapi has no wasi-sdk 34 directory', async (t) => {
  const { projectDir } = t.context
  const emnapiLibDir = await createEmnapiLibDir(projectDir, [
    'wasm32-wasip1-threads',
  ])
  const wasiSdkPath = await createWasiSdkDir(projectDir, '34.0')

  t.deepEqual(
    selectEmnapiLinkDir(
      emnapiLibDir,
      'wasm32-wasip1-threads',
      true,
      wasiSdkPath,
    ),
    {
      linkDirName: 'wasm32-wasip1-threads',
      wasiSdkMajor: 34,
      needsWasiSdk34: true,
    },
  )
})
