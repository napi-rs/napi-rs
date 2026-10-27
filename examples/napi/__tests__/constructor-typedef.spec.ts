import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'
import ts from 'typescript'

import { OptionalBeforeRequiredClass } from '../index.cjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// CI type-checks with skipLibCheck, which hides errors inside the generated
// declarations, so check them here with it off.
test('generated constructors have no required parameter after an optional one', (t) => {
  const program = ts.createProgram([join(__dirname, '..', 'index.d.cts')], {
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['node'],
  })
  const errors = ts
    .getPreEmitDiagnostics(program)
    // TS1016: A required parameter cannot follow an optional parameter.
    .filter((diagnostic) => diagnostic.code === 1016)
    .map((diagnostic) => {
      const { line } = diagnostic.file!.getLineAndCharacterOfPosition(
        diagnostic.start!,
      )
      const text = diagnostic.file!.text.split('\n')[line].trim()
      return `index.d.cts:${line + 1}: ${text}`
    })
  t.deepEqual(errors, [])
})

test('an optional constructor argument before a required one is positional', (t) => {
  // The required argument stays in its own position.
  const first = new OptionalBeforeRequiredClass(undefined, 1)
  t.is(first.requiredNumberField, 1)

  const second = new OptionalBeforeRequiredClass(2, 3, 's')
  t.is(second.optionalNumberField, 2)
  t.is(second.requiredNumberField, 3)
  t.is(second.optionalStringField, 's')
})
