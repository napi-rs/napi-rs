import runtime from './index.cjs'

export const BINDING_MISMATCH_CODE = runtime.BINDING_MISMATCH_CODE
export const BindingMismatchError = runtime.BindingMismatchError
export const CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION =
  runtime.CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION
export const MAX_HOST_TIMEOUT_MS = runtime.MAX_HOST_TIMEOUT_MS
export const installCurrentThreadHosts = runtime.installCurrentThreadHosts
export const isBindingMismatchError = runtime.isBindingMismatchError
export const registerWorkerdCurrentThreadTaskHost =
  runtime.registerWorkerdCurrentThreadTaskHost
export const registerWorkerdTimerHost = runtime.registerWorkerdTimerHost
