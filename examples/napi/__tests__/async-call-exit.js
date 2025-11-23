import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { acceptStream } from '../index.cjs'

const buf = await acceptStream(
  Readable.toWeb(createReadStream(fileURLToPath(import.meta.url))),
)
console.log(buf.toString('utf-8'))
