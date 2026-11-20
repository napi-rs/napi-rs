import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import { attachWatchStderr } from '../build.js'

test('attachWatchStderr decodes multi-byte UTF-8 split across chunks', async (t) => {
  const stream = new PassThrough()
  const lines: string[] = []
  let finishedCount = 0

  attachWatchStderr(
    stream,
    (line) => {
      lines.push(line)
    },
    () => {
      finishedCount += 1
    },
  )

  const message = 'warning: compiling /tmp/日本/src/lib.rs'
  const bytes = Buffer.from(`${message}\n`)
  const split = bytes.indexOf(Buffer.from('日')) + 1

  const ended = new Promise<void>((resolve) => {
    stream.once('end', resolve)
  })
  stream.write(bytes.subarray(0, split))
  stream.end(bytes.subarray(split))
  await ended

  t.deepEqual(lines, [message])
  t.false(lines[0].includes('\uFFFD'))
  t.is(finishedCount, 0)
})

test('attachWatchStderr detects Finished markers split across chunks and line endings', async (t) => {
  const stream = new PassThrough()
  const lines: string[] = []
  let finishedCount = 0

  attachWatchStderr(
    stream,
    (line) => {
      lines.push(line)
    },
    () => {
      finishedCount += 1
    },
  )

  const ended = new Promise<void>((resolve) => {
    stream.once('end', resolve)
  })

  // Split inside `Finished`
  stream.write(Buffer.from('   Compiling my-addon v0.1.0\n    Fini'))
  t.is(finishedCount, 0)
  stream.write(
    Buffer.from('shed `dev` profile [unoptimized + debuginfo] in 0.42s\n'),
  )
  t.is(finishedCount, 1)

  // Split inside CRLF and profile name
  stream.write(Buffer.from('    Finished `rel'))
  t.is(finishedCount, 1)
  stream.write(Buffer.from('ease` profile [optimized] in 1.23s\r'))
  t.is(finishedCount, 1)
  stream.write(Buffer.from('\n'))
  t.is(finishedCount, 2)

  // Trailing Finished line flushed on EOF without newline
  stream.end(Buffer.from('    Finished `dev` profile [unoptimized] in 0.10s'))
  await ended
  t.is(finishedCount, 3)
  t.deepEqual(lines, [
    '   Compiling my-addon v0.1.0',
    '    Finished `dev` profile [unoptimized + debuginfo] in 0.42s',
    '    Finished `release` profile [optimized] in 1.23s',
    '    Finished `dev` profile [unoptimized] in 0.10s',
  ])
})

test('watch stderr forwarding survives a disconnected stderr reader', async (t) => {
  const buildModulePath = fileURLToPath(new URL('../build.ts', import.meta.url))
  const child = spawn(
    process.execPath,
    [
      '--import',
      '@oxc-node/core/register',
      '-e',
      `
const { PassThrough } = require('node:stream')
const { attachWatchStderr } = require(${JSON.stringify(buildModulePath)})
const stream = new PassThrough()
let finished = 0
attachWatchStderr(stream, (line) => console.error(line), () => { finished += 1 })
setTimeout(() => {
  stream.write(Buffer.from('    Fini'))
  stream.end(Buffer.from('shed \`dev\` profile [unoptimized] in 0.10s\\n'))
  setTimeout(() => {
    process.stdout.write(String(finished))
  }, 50)
}, 50)
`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  child.stderr.destroy()
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  t.is(exitCode, 0)
  t.is(stdout, '1')
})
