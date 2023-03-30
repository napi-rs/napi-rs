import * as colors from 'colorette'
import rawDebug from 'debug'

// debug('%i', 'This is an info')
rawDebug.formatters.i = (v) => {
  return colors.green(v)
}

declare module 'debug' {
  interface Debugger {
    info: typeof console.error
    warn: typeof console.error
    error: typeof console.error
  }
}

export const debugFactory = (namespace: string) => {
  const debug = rawDebug(`napi:${namespace}`)

  debug.info = (...args: any[]) =>
    console.error(colors.black(colors.bgGreen(' INFO ')), ...args)
  debug.warn = (...args: any[]) =>
    console.error(colors.black(colors.bgYellow(' WARNING ')), ...args)
  debug.error = (...args: any[]) =>
    console.error(
      colors.white(colors.bgRed(' ERROR ')),
      ...args.map((arg) =>
        arg instanceof Error ? arg.stack ?? arg.message : arg,
      ),
    )

  return debug
}
export const debug = debugFactory('utils')
