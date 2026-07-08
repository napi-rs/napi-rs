import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import test from 'ava'
import typeScript from 'typescript'

import { mergeLifecycleDeclarations } from '../build.mjs'
import { unsupportedWasiFunctions } from '../unsupported-wasi-exports.mjs'

test('WASI declaration preservation is idempotent and dependency-closed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-wasi-declarations-'))
  try {
    const generatedSource = 'export interface Generated {}'
    const lifecycleHandle = `export interface AsyncWorkLifecycleHandle {
  id: number
  promise: Promise<number>
}`
    const requestInit = `export interface RequestInit {
  method?: string
}`
    const declarations = unsupportedWasiFunctions.map((name, index) =>
      index === 0
        ? `export declare function ${name}(): AsyncWorkLifecycleHandle`
        : `export declare function ${name}(): void`,
    )
    const previousSource = `${lifecycleHandle}\n\n${requestInit}\n\n${declarations.join('\n\n')}\n`

    const firstBuild = mergeLifecycleDeclarations(
      generatedSource,
      previousSource,
    )
    const secondBuild = mergeLifecycleDeclarations(generatedSource, firstBuild)

    t.is(secondBuild, firstBuild)
    t.true(firstBuild.endsWith(`${declarations.at(-1)}\n`))
    t.is(firstBuild.split(lifecycleHandle).length - 1, 1)
    t.is(firstBuild.split(requestInit).length - 1, 1)
    t.true(
      firstBuild.indexOf(lifecycleHandle) < firstBuild.indexOf(declarations[0]),
    )
    for (const declaration of declarations) {
      t.is(firstBuild.split(declaration).length - 1, 1)
    }

    const declarationPath = join(directory, 'index.d.ts')
    await writeFile(declarationPath, firstBuild)
    const program = typeScript.createProgram([declarationPath], {
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
