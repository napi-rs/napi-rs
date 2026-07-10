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
  }
}
