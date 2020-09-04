import debug from 'debug'

export const debugFactory = (namespace: string) => debug(`napi:${namespace}`)
