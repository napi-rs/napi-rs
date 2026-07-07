import test from 'ava'

import { mergeLifecycleDeclarations } from '../build.mjs'
import { unsupportedWasiFunctions } from '../unsupported-wasi-exports.mjs'

test('WASI declaration preservation is idempotent when the last declaration ends at EOF', (t) => {
  const generatedSource = 'export interface Generated {}'
  const declarations = unsupportedWasiFunctions.map(
    (name) => `export declare function ${name}(): void`,
  )
  const previousSource = `${declarations.join('\n\n')}\n`

  const firstBuild = mergeLifecycleDeclarations(generatedSource, previousSource)
  const secondBuild = mergeLifecycleDeclarations(generatedSource, firstBuild)

  t.is(secondBuild, firstBuild)
  t.true(firstBuild.endsWith(`${declarations.at(-1)}\n`))
  for (const declaration of declarations) {
    t.is(firstBuild.split(declaration).length - 1, 1)
  }
})
