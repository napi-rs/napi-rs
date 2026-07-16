'use strict'

const BINDING_MISMATCH_CODE = 'ERR_NAPI_ASYNC_RUNTIME_BINDING_MISMATCH'

class BindingMismatchError extends TypeError {
  code = BINDING_MISMATCH_CODE
}

function isBindingMismatchError(error) {
  if (
    (typeof error !== 'object' || error === null) &&
    typeof error !== 'function'
  ) {
    return false
  }
  try {
    return Reflect.get(error, 'code') === BINDING_MISMATCH_CODE
  } catch {
    return false
  }
}

function markBindingMismatchError(error) {
  return Object.assign(error, {
    code: BINDING_MISMATCH_CODE,
  })
}

module.exports = {
  BINDING_MISMATCH_CODE,
  BindingMismatchError,
  isBindingMismatchError,
  markBindingMismatchError,
}
