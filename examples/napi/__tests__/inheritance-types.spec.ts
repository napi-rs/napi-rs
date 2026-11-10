import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'
import ts from 'typescript'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('generated declarations inherit instance members only', (t) => {
  const program = ts.createProgram(
    [join(__dirname, 'fixtures', 'inheritance-types.ts')],
    {
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      types: ['node'],
    },
  )
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  t.deepEqual(diagnostics, [])
})
