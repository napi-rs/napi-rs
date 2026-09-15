/**
 * `@napi-rs/async-runtime/workerd` — only the two per-instance host
 * registrars, for bundles that run in an isolate (workerd, and the generated
 * deferred loader in general). The barrel additionally pulls in
 * `current-thread-hosts.cjs`, whose realm-global registry and Node timer-handle
 * bookkeeping such a bundle never executes, and a CJS barrel is not
 * tree-shakeable. Both entries are otherwise identical and equally isolate
 * safe: neither reaches for a `node:` builtin or `process`.
 */
export type { AsyncRuntimeBinding } from './index.js'
export {
  registerWorkerdCurrentThreadTaskHost,
  registerWorkerdTimerHost,
} from './index.js'
