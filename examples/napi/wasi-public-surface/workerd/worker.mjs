import wasmModule from '@examples/napi/wasm'
import { createInstance, dispose, instantiate } from '@examples/napi/workerd'

const tokioErrorMessage =
  'Built-in Tokio async tasks require a threaded WASI target. Use wasm32-wasip1-threads, or enable async-runtime and register a custom AsyncRuntime backend for wasm32-wasip1.'

async function runLifecycle() {
  let singletonActive = false
  let firstIndependent
  let secondIndependent

  try {
    let binding = await instantiate(wasmModule)
    singletonActive = true
    const output = binding.getBuffer()
    const BufferConstructor = output.constructor
    const appended = binding.appendBuffer(
      BufferConstructor.from('workerd threadless input'),
    )
    let tokioError

    try {
      await binding.asyncPlus100(Promise.resolve(1))
    } catch (error) {
      tokioError = error?.message
    }

    const singletonResult = {
      add: binding.add(20, 22),
      output: output.toString(),
      outputIsBuffer: BufferConstructor.isBuffer(output),
      appended: appended.toString(),
      appendedIsBuffer: BufferConstructor.isBuffer(appended),
      tokioError,
      addAfterTokioError: binding.add(19, 23),
    }

    await dispose()
    singletonActive = false
    binding = undefined

    firstIndependent = await createInstance(wasmModule)
    secondIndependent = await createInstance(wasmModule)
    const independentExportsAreDistinct =
      firstIndependent.exports !== secondIndependent.exports
    const firstIndependentAdd = firstIndependent.exports.add(17, 25)
    await firstIndependent.dispose()
    firstIndependent = undefined
    const secondAfterFirstDispose = secondIndependent.exports.add(18, 24)
    await secondIndependent.dispose()
    secondIndependent = undefined

    binding = await instantiate(wasmModule)
    singletonActive = true
    const recreatedAdd = binding.add(21, 21)

    await dispose()
    singletonActive = false

    return {
      ...singletonResult,
      expectedTokioError: tokioErrorMessage,
      independentExportsAreDistinct,
      firstIndependentAdd,
      secondAfterFirstDispose,
      recreatedAdd,
      hasGlobalBuffer: typeof globalThis.Buffer !== 'undefined',
      hasNodeProcess: typeof process !== 'undefined',
    }
  } finally {
    await firstIndependent?.dispose().catch(() => {})
    await secondIndependent?.dispose().catch(() => {})
    if (singletonActive) {
      await dispose().catch(() => {})
    }
  }
}

async function runGrowth() {
  let singletonActive = false

  try {
    const binding = await instantiate(wasmModule)
    singletonActive = true
    const beforeBytes = binding.getBuffer().buffer.byteLength
    const width = 3072
    const height = 4096
    const allocation = new binding.CustomFinalize(width, height)
    const afterBytes = binding.getBuffer().buffer.byteLength

    return {
      beforeBytes,
      afterBytes,
      allocationBytes: width * height * 4,
      allocationType: allocation.constructor.name,
      addAfterGrowth: binding.add(20, 22),
    }
  } finally {
    if (singletonActive) {
      await dispose().catch(() => {})
    }
  }
}

export default {
  async fetch(request) {
    try {
      const pathname = new URL(request.url).pathname
      if (pathname === '/lifecycle') {
        return Response.json(await runLifecycle())
      }
      if (pathname === '/growth') {
        return Response.json(await runGrowth())
      }
      return new Response('Not found', { status: 404 })
    } catch (error) {
      return new Response(String(error?.stack || error), { status: 599 })
    }
  },
}
