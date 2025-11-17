import * as colors from 'colorette'
import { createDebug } from 'obug'

declare module 'obug' {
  interface Debugger {
    info: typeof console.error
    warn: typeof console.error
    error: typeof console.error
  }
}

export const debugFactory = (namespace: string) => {
  const debug = createDebug(`napi:${namespace}`, {
    formatters: {
      // debug('%i', 'This is an info')
      i(v) {
        return colors.green(v)
      },
    },
  })

  debug.info = (...args: any[]) =>
    console.error(colors.black(colors.bgGreen(' INFO ')), ...args)
  debug.warn = (...args: any[]) =>
    console.error(colors.black(colors.bgYellow(' WARNING ')), ...args)
  debug.error = (...args: any[]) =>
    console.error(
      colors.white(colors.bgRed(' ERROR ')),
      ...args.map((arg) =>
        arg instanceof Error ? (arg.stack ?? arg.message) : arg,
      ),
    )

  return debug
}
export const debug = debugFactory('utils')
