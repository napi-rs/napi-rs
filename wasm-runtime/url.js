// Browser shim for `node:url`.
// `URL` and `URLSearchParams` are Web platform globals and are also available
// in WASI runtimes, so they can be re-exported directly.
export const URL = globalThis.URL
export const URLSearchParams = globalThis.URLSearchParams
export const URLPattern = globalThis.URLPattern
