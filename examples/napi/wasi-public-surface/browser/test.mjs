const tokioErrorMessage =
  'Built-in Tokio async tasks require a threaded WASI target. Use wasm32-wasip1-threads, or enable async-runtime and register a custom AsyncRuntime backend for wasm32-wasip1.'

export async function run() {
  const binding = await import('@examples/napi')
  const output = binding.getBuffer()
  const BufferConstructor = output.constructor
  const appended = binding.appendBuffer(
    BufferConstructor.from('browser threadless input'),
  )
  let tokioError

  try {
    await binding.asyncPlus100(Promise.resolve(1))
  } catch (error) {
    tokioError = error?.message
  }

  // Regression: a Buffer returned before a `memory.grow` must survive it. On
  // threadless wasm the memory is not shared, so growing detaches the previous
  // ArrayBuffer and a view over it would read back as ''.
  const memoryBeforeGrowth = binding.wasmMemorySizeBytes()
  const heldOutput = binding.getBuffer()
  // 512 * 1024 * 4 bytes: far more than the initial dlmalloc arena.
  const growth = new binding.CustomFinalize(512, 1024)
  const memoryAfterGrowth = binding.wasmMemorySizeBytes()

  return {
    crossOriginIsolated: globalThis.crossOriginIsolated,
    sharedArrayBufferType: typeof globalThis.SharedArrayBuffer,
    hasGlobalBuffer: typeof globalThis.Buffer !== 'undefined',
    add: binding.add(20, 22),
    output: output.toString(),
    outputIsBuffer: BufferConstructor.isBuffer(output),
    appended: appended.toString(),
    appendedIsBuffer: BufferConstructor.isBuffer(appended),
    tokioError,
    expectedTokioError: tokioErrorMessage,
    addAfterTokioError: binding.add(19, 23),
    memoryBeforeGrowth,
    memoryAfterGrowth,
    growthType: growth.constructor.name,
    heldOutput: heldOutput.toString(),
    heldOutputLength: heldOutput.length,
  }
}
