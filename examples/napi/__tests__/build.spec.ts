import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import test from 'ava'
import typeScript from 'typescript'

import { preserveLifecycleDeclarations } from '../build.mjs'
import { unsupportedWasiFunctions } from '../unsupported-wasi-exports.mjs'

test('WASI declaration preservation covers both public files and is dependency-closed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-wasi-declarations-'))
  try {
    const generatedSource = 'export interface Generated {}\n'
    const lifecycleHandle = `export interface AsyncWorkLifecycleHandle {
  id: number
  promise: Promise<number>
}`
    const requestInit = `export interface RequestInit {
  method?: string
}`
    const declarations = unsupportedWasiFunctions.map((name) =>
      name === 'createQueuedAsyncWorkLifecycle'
        ? `export declare function ${name}(): AsyncWorkLifecycleHandle`
        : name === 'fetch'
          ? `export declare function ${name}(requestInit?: RequestInit): Promise<void>`
          : `export declare function ${name}(): void`,
    )
    const previousSource = `${lifecycleHandle}\n\n${requestInit}\n\n${declarations.join('\n\n')}\n`
    const declarationPaths = ['index.d.ts', 'example.wasi.d.ts'].map((file) =>
      join(directory, file),
    )
    await Promise.all(
      declarationPaths.map((path) => writeFile(path, generatedSource)),
    )
    await preserveLifecycleDeclarations(declarationPaths, previousSource)

    const firstBuild = await Promise.all(
      declarationPaths.map((path) => readFile(path, 'utf8')),
    )
    t.is(firstBuild[1], firstBuild[0])

    await Promise.all(
      declarationPaths.map((path) => writeFile(path, generatedSource)),
    )
    await preserveLifecycleDeclarations(declarationPaths, firstBuild[0])

    const secondBuild = await Promise.all(
      declarationPaths.map((path) => readFile(path, 'utf8')),
    )
    t.deepEqual(secondBuild, firstBuild)

    for (const source of secondBuild) {
      t.true(source.endsWith(`${declarations.at(-1)}\n`))
      for (const dependency of [lifecycleHandle, requestInit]) {
        t.is(source.split(dependency).length - 1, 1)
      }
      t.true(
        source.indexOf(lifecycleHandle) <
          source.indexOf(
            declarations.find((declaration) =>
              declaration.includes('AsyncWorkLifecycleHandle'),
            )!,
          ),
      )
      t.true(
        source.indexOf(requestInit) <
          source.indexOf(
            declarations.find((declaration) =>
              declaration.includes('requestInit?: RequestInit'),
            )!,
          ),
      )
      for (const declaration of declarations) {
        t.is(source.split(declaration).length - 1, 1)
      }
    }

    const program = typeScript.createProgram(declarationPaths, {
      lib: ['lib.es2022.d.ts'],
      noEmit: true,
      skipLibCheck: false,
      strict: true,
    })
    const diagnostics = typeScript
      .getPreEmitDiagnostics(program)
      .map((diagnostic) =>
        typeScript.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      )
    t.deepEqual(diagnostics, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
