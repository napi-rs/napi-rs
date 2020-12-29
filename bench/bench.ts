import { promises as fs } from 'fs'
import { join } from 'path'

import { Summary } from 'benny/lib/internal/common-types'

import { benchAsync } from './async'
import { benchBuffer } from './buffer'
import { benchGetSetProperty } from './get-set-property'
import { benchNoop } from './noop'
import { benchPlus } from './plus'

async function run() {
  const output = [
    await benchNoop(),
    await benchPlus(),
    await benchBuffer(),
    await benchGetSetProperty(),
    await benchAsync(),
  ]
    .map(formatSummary)
    .join('\n')

  await fs.writeFile(join(process.cwd(), 'bench.txt'), output, 'utf8')
}

function formatSummary(summary: Summary): string {
  return summary.results
    .map(
      (result) =>
        `${summary.name}#${result.name} x ${result.ops} ops/sec ±${result.margin}% (${result.samples} runs sampled)`,
    )
    .join('\n')
}

run().catch((e) => {
  console.error(e)
})
