import { spawn as _spawn, SpawnOptionsWithoutStdio } from 'child_process'

import { debugFactory } from './debug'

const debug = debugFactory('spawn')

export function spawn(
  command: string,
  options: SpawnOptionsWithoutStdio = {},
): Promise<Buffer> {
  const [cmd, ...args] = command.split(' ').map((s) => s.trim())
  debug(`execute ${cmd} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const spawnStream = _spawn(cmd, args, { ...options, shell: true })
    const chunks: Buffer[] = []
    process.stdin.pipe(spawnStream.stdin)
    spawnStream.stdout?.on('data', (chunk) => {
      chunks.push(chunk)
    })
    spawnStream.stdout.pipe(process.stdout)
    spawnStream.stderr.pipe(process.stderr)
    spawnStream.on('close', (code) => {
      if (code !== 0) {
        reject()
      } else {
        resolve(Buffer.concat(chunks))
      }
    })
  })
}
