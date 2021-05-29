import { createSuite } from './test-util.mjs'

await createSuite('tokio-future')
await createSuite('serde')

process.exit(0)
