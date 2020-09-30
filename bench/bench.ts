import { benchAsync } from './async'
import { benchNoop } from './noop'
import { benchPlus } from './plus'

async function run() {
  await benchNoop()
  await benchPlus()
  await benchAsync()
}

run().catch((e) => {
  console.error(e)
})
