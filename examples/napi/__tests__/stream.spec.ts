import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import {} from 'node:stream/promises'

import test from 'ava'

import { acceptStream, createReadableStream } from '../index.cjs'
import { fileURLToPath } from 'node:url'

test('acceptStream', async (t) => {
  const selfPath = fileURLToPath(import.meta.url)
  const nodeFileStream = createReadStream(selfPath)
  const buffer = await acceptStream(Readable.toWeb(nodeFileStream))
  t.is(buffer.toString('utf-8'), await readFile(selfPath, 'utf-8'))
})

test('create readable stream from channel', async (t) => {
  const stream = await createReadableStream()
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  t.is(Buffer.concat(chunks).toString('utf-8'), 'hello'.repeat(100))
})
