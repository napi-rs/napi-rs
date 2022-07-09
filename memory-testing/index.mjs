import { createSuite } from './test-util.mjs'

await createSuite('reference')
await createSuite('tokio-future')
await createSuite('serde')
await createSuite('tsfn')
await createSuite('buffer')
