/**
 * The CommonJS declaration for `@napi-rs/async-runtime/workerd`. This package
 * is `type: module`, so `workerd.d.ts` is an ESM declaration and a `.cts`
 * consumer under `moduleResolution: node16` would be told it cannot `require`
 * it (TS1479) even though `workerd.cjs` is exactly what `require` resolves to.
 * The types are read back out of the ESM declaration under an explicit
 * `resolution-mode`, so the two entries can never describe different shapes.
 */
import type * as WorkerdHosts from './workerd.js' with {
  'resolution-mode': 'import',
}

export type AsyncRuntimeBinding = WorkerdHosts.AsyncRuntimeBinding
export declare const registerWorkerdCurrentThreadTaskHost: typeof WorkerdHosts.registerWorkerdCurrentThreadTaskHost
export declare const registerWorkerdTimerHost: typeof WorkerdHosts.registerWorkerdTimerHost
