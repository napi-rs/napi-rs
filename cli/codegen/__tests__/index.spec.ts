import test from 'ava'

import { generateCommandDef } from '../index.js'

test('generateCommandDef combines numeric and custom validators', (t) => {
  const output = generateCommandDef({
    name: 'example',
    description: 'Example command',
    args: [],
    options: [
      {
        name: 'value',
        type: 'number',
        description: 'A numeric value',
        validator: 'typanion.isInteger()',
      },
    ],
  })

  t.is(output.match(/^\s+validator:/gm)?.length, 1)
  t.true(
    output.includes(
      'validator: typanion.cascade(typanion.isNumber(), typanion.isInteger()),',
    ),
  )
})
