export type WasiBinding = typeof import('./example.wasip1.cjs')

export type WasiModuleInput =
  WebAssembly.Module | PromiseLike<WebAssembly.Module>

export interface WasiInstance {
  readonly exports: WasiBinding
  dispose(): void | Promise<void>
}

export function instantiate(wasmInput: WasiModuleInput): Promise<WasiBinding>
export function createInstance(
  wasmInput: WasiModuleInput,
): Promise<WasiInstance>
export function dispose(): Promise<void>
