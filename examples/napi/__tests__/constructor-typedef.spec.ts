import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'
import ts from 'typescript'

import { OptionalBeforeRequiredClass } from '../index.cjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const declarationFile = join(__dirname, '..', 'index.d.cts')

// CI type-checks with skipLibCheck, which hides errors inside the generated
// declarations, so check them here with it off.
const program = ts.createProgram([declarationFile], {
  noEmit: true,
  skipLibCheck: false,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: ['node'],
})

test('generated constructors have no required parameter after an optional one', (t) => {
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

test('an optional constructor argument before a required one accepts undefined', (t) => {
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(declarationFile)!
  const moduleSymbol = checker.getSymbolAtLocation(source)!
  for (const name of [
    'OptionalBeforeRequiredClass',
    'OptionalConditionalBeforeRequiredClass',
  ]) {
    const classSymbol = checker
      .getExportsOfModule(moduleSymbol)
      .find((symbol) => symbol.name === name)!
    const [signature] = checker
      .getTypeOfSymbol(classSymbol)
      .getConstructSignatures()
    const [first] = signature.getParameters()
    t.true(
      checker.isTypeAssignableTo(
        checker.getUndefinedType(),
        checker.getTypeOfSymbol(first),
      ),
      `${name}: ${checker.typeToString(checker.getTypeOfSymbol(first))}`,
    )
  }
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
