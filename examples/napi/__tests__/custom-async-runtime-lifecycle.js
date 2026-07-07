import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const bindingFile = fileURLToPath(
  new URL('../../custom-async-runtime/index.cjs', import.meta.url),
)
const lifecycleModuleUrl = new URL(
  '../../custom-async-runtime/runtime-lifecycle-helper.mjs',
  import.meta.url,
)
const pureLifecycleModuleUrl = new URL(
  '../../custom-async-runtime/pure-runtime-lifecycle.mjs',
  import.meta.url,
)
const { runCombinedRuntimeLifecycle, runSubmissionTransitionLifecycle } =
  await import(lifecycleModuleUrl.href)
const scenario = process.argv[2] ?? 'combined'

switch (scenario) {
  case 'combined':
    await runCombinedRuntimeLifecycle(bindingFile)
    break
  case 'submission-transitions':
    await runSubmissionTransitionLifecycle(bindingFile)
    break
  case 'retained-waker': {
    const require = createRequire(import.meta.url)
    const binding = require(bindingFile)
    binding.retainTaskWaker()
    process.stderr.write('retained custom-runtime task waker armed\n')
    binding.shutdownRuntime()
    throw new Error('shutdown unexpectedly returned with a retained task waker')
  }
  case 'pure-registration-race': {
    const { findPureRuntimeBinding, runPureRuntimeRegistrationRace } =
      await import(pureLifecycleModuleUrl.href)
    await runPureRuntimeRegistrationRace(await findPureRuntimeBinding())
    break
  }
  default:
    throw new TypeError(
      `unknown custom runtime lifecycle scenario: ${scenario}`,
    )
}
