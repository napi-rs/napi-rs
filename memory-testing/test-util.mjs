import { setTimeout } from 'timers'
import { promisify } from 'util'

import chalk from 'chalk'
import Dockerode from 'dockerode'
import prettyBytes from 'pretty-bytes'

const sleep = promisify(setTimeout)

const client = new Dockerode()

export async function createSuite(testFile, maxMemoryUsage) {
  console.info(chalk.cyanBright('Create container'))

  const container = await client.createContainer({
    Image: 'node:lts-slim',
    Cmd: ['/bin/bash', '-c', `node --expose-gc memory-testing/${testFile}.mjs`],
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    WorkingDir: '/napi-rs',
    Env: ['MAX_OLD_SPACE_SIZE=256', 'FORCE_COLOR=1'],
    HostConfig: {
      Binds: [`${process.cwd()}:/napi-rs:rw`],
      Memory: 256 * 1024 * 1024,
    },
  })

  console.info(chalk.cyanBright('Container created, starting ...'))

  await container.start()

  container.attach(
    { stream: true, stdout: true, stderr: true },
    function (err, stream) {
      if (err) {
        console.error(err)
        process.exit(1)
      }
      stream.pipe(process.stdout)
    },
  )

  const stats = await container.stats()

  let shouldAssertMemoryUsage = false

  const initialMemoryUsage = await new Promise((resolve, reject) => {
    stats.on('data', (d) => {
      const { memory_stats } = JSON.parse(d.toString('utf8'))
      resolve(memory_stats.usage)
      if (shouldAssertMemoryUsage && memory_stats?.usage) {
        const memoryGrowth = memory_stats.usage - initialMemoryUsage
        if (memoryGrowth > maxMemoryUsage ?? initialMemoryUsage) {
          console.info(
            chalk.redBright(
              `Potential memory leak, memory growth: ${prettyBytes(
                memoryGrowth,
              )}`,
            ),
          )
          process.exit(1)
        }
      }
    })
    stats.on('error', reject)
  })

  console.info(
    chalk.red(`Initial memory usage: ${prettyBytes(initialMemoryUsage)}`),
  )

  await sleep(60000)

  shouldAssertMemoryUsage = true

  await container.stop()
  await container.remove()
}
