import { readFile } from 'fs/promises'

import { createNapiModule } from '@emnapi/core'
import { getDefaultContext } from '@emnapi/runtime'
import { WASI } from 'wasi'

export async function initWasiModule(wasiModulePath: string) {
  const context = getDefaultContext()

  const napiModule = createNapiModule({
    context,
  })

  const wasi = new WASI()

  const wasmBuffer = await readFile(wasiModulePath)

  const { instance, module: wasiModule } = await WebAssembly.instantiate(
    wasmBuffer,
    {
      wasi_snapshot_preview1: wasi.wasiImport,
      env: {
        ...napiModule.imports.env,
        ...napiModule.imports.napi,
        ...napiModule.imports.emnapi,
      },
    },
  )

  wasi.initialize(instance)

  return napiModule.init({
    instance,
    module: wasiModule,
    // @ts-expect-error
    memory: instance.exports.memory,
    // @ts-expect-error
    table: instance.exports.__indirect_function_table,
  })
}
