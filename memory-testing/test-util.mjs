import { setTimeout } from 'timers'
import { promisify } from 'util'

import * as colors from 'colorette'
import Dockerode from 'dockerode'
import prettyBytes from 'pretty-bytes'

const sleep = promisify(setTimeout)

const client = new Dockerode()

export async function createSuite(testFile, maxMemoryUsage) {
  console.info(colors.cyanBright(`Create container to test ${testFile}`))

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

  console.info(colors.cyanBright('Container created, starting ...'))

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
  let initialMemoryUsage
  await new Promise((resolve, reject) => {
    const initialDate = Date.now()
    stats.on('data', (d) => {
      const { memory_stats } = JSON.parse(d.toString('utf8'))
      if (Date.now() - initialDate > 10000 && !shouldAssertMemoryUsage) {
        initialMemoryUsage = memory_stats.usage
        shouldAssertMemoryUsage = true
        resolve()
      }
      if (shouldAssertMemoryUsage && memory_stats?.usage) {
        const memoryGrowth = memory_stats.usage - initialMemoryUsage
        if (memoryGrowth > (maxMemoryUsage ?? initialMemoryUsage)) {
          console.info(
            colors.redBright(
              `Potential memory leak, memory growth: ${prettyBytes(
                memoryGrowth,
              )}, test file: ${testFile}`,
            ),
          )
          process.exit(1)
        }
      }
    })
    stats.on('error', reject)
  })

  console.info(
    colors.red(`Initial memory usage: ${prettyBytes(initialMemoryUsage ?? 0)}`),
  )

  await sleep(60000)

  try {
    await container.stop()
    await container.remove()
  } catch (e) {
    console.error(e)
  }
}
