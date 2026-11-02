import {
  asyncWork as upstreamAsyncWork,
  tsfn as upstreamTSFN,
} from '@emnapi/core/plugins'

// The bundled plugins come from one @emnapi/core v2 release, but published
// bindings pin any v2 prerelease from 2.0.0-alpha.1 on. The plugin context
// field that holds the addon module was renamed in 2.0.0-beta.1:
//
//   2.0.0-alpha.1 .. 2.0.0-alpha.6  ->  `napiModule`
//   2.0.0-beta.1 and later          ->  `addonModule`
//
// The bundled (beta) plugins read and write `addonModule.initWorker`,
// `.postMessage` and `.childThread` while the module is created, so on an alpha
// core they threw "Cannot set properties of undefined (setting 'initWorker')".
// Every other context field the plugins read exists in all of these releases.
//
// Add the new name as an alias on the alpha context. The alias is defined on
// the context object itself, not on a copy: the TSFN plugin stores
// `emnapiTSFN` on the context and the async-work plugin reads it back later,
// so both plugins must keep seeing the same object.
const withAddonModuleAlias = (plugin) => {
  const compatPlugin = (ctx) => {
    if (
      ctx !== null &&
      typeof ctx === 'object' &&
      !('addonModule' in ctx) &&
      'napiModule' in ctx
    ) {
      Object.defineProperty(ctx, 'addonModule', {
        get: () => ctx.napiModule,
        enumerable: false,
        configurable: true,
      })
    }
    return plugin(ctx)
  }
  Object.defineProperty(compatPlugin, 'name', { value: plugin.name })
  return compatPlugin
}

export const emnapiAsyncWorkPlugin = withAddonModuleAlias(upstreamAsyncWork)
export const emnapiTSFNPlugin = withAddonModuleAlias(upstreamTSFN)
