// Injected by esbuild (`inject`) when bundling the worker: every free
// reference to `setImmediate` in the bundle resolves to this export.
//
// workerd's timer functions enforce that they are called with the global
// scope as `this`. emnapi's runtime captures the bare `setImmediate` global
// into its feature object and later calls it as
// `emnapiCtx.feature.setImmediate(...)` — a detached call with the wrong
// receiver, which workerd rejects with "TypeError: Illegal invocation".
// Rebinding the global to `globalThis` at bundle time fixes the receiver
// without patching emnapi.
const boundSetImmediate =
  typeof globalThis.setImmediate === 'function'
    ? globalThis.setImmediate.bind(globalThis)
    : (callback, ...args) => globalThis.setTimeout(callback, 0, ...args)

export { boundSetImmediate as setImmediate }
