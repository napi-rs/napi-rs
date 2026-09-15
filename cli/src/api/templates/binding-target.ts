/**
 * The `__napiBindingTarget` contract, shared by every generated loader.
 *
 * This module deliberately imports nothing: both `js-binding.ts` and
 * `load-wasi-template.ts` depend on it, and `load-wasi-template.ts` otherwise
 * has no top-level imports at all. Keeping the contract at the bottom of the
 * graph is what lets both templates emit the same runtime helper without
 * duplicating its source.
 */

/**
 * Named export every generated loader uses to report which binding artifact
 * actually loaded: `'native'` for a `.node` addon, otherwise the
 * `platformArchABI` of the WASI flavor (`'wasm32-wasi'`, `'wasm32-wasip1'`).
 */
export const NAPI_BINDING_TARGET_EXPORT = '__napiBindingTarget'

/**
 * `code` on the error the emitted loader throws when the binding it loaded
 * already owns {@link NAPI_BINDING_TARGET_EXPORT}. Named after the other
 * loader-thrown codes (`ERR_NAPI_WASI_LIFECYCLE_REENTRY`,
 * `ERR_NAPI_WASI_CLEANUP_PENDING`, `ERR_NAPI_ASYNC_RUNTIME_BINDING_MISMATCH`)
 * so a consumer can branch on it instead of on the message.
 */
export const ERR_NAPI_BINDING_TARGET_CONFLICT =
  'ERR_NAPI_BINDING_TARGET_CONFLICT'

/** Name of the runtime helper {@link BINDING_TARGET_STAMP_HELPER} declares. */
export const NAPI_BINDING_TARGET_STAMP_FN = '__napiStampBindingTarget'

/**
 * Reject an export of {@link NAPI_BINDING_TARGET_EXPORT} at build time.
 *
 * `idents` is the type-def export list, so this only sees what napi-rs type
 * generation reports. A name attached imperatively by a
 * `#[napi(module_exports)]` hook emits no type-def entry and is invisible here
 * — the same blind spot `typeDefAvailable` documents for the sibling check.
 * {@link BINDING_TARGET_STAMP_HELPER} is what catches those, at load time.
 *
 * What this check is load-bearing for: a duplicated ident would emit a
 * duplicate `export const` in the ESM loader (a syntax error), and would make
 * the CJS loader overwrite its own reported target.
 */
export function assertBindingTargetIdentFree(idents: string[]): void {
  if (idents.indexOf(NAPI_BINDING_TARGET_EXPORT) !== -1) {
    throw new Error(
      `\`${NAPI_BINDING_TARGET_EXPORT}\` is reserved by the generated binding loader. Rename the napi export, e.g. #[napi(js_name = "...")].`,
    )
  }
}

/**
 * Runtime helper emitted into every loader that stamps
 * {@link NAPI_BINDING_TARGET_EXPORT} onto an exports object it does not own.
 *
 * Five outcomes, in order:
 *
 * | exports object state            | result                                    |
 * | ------------------------------- | ----------------------------------------- |
 * | own property, same value        | no-op, returns `target`                   |
 * | own property, different value   | throw, `ERR_NAPI_BINDING_TARGET_CONFLICT` |
 * | non-extensible, no own property | skip, returns `target`                    |
 * | refuses the definition          | skip, returns `target`                    |
 * | otherwise                       | stamp, returns `target`                   |
 *
 * The stamp is `Object.defineProperty`, not an assignment. `hasOwnProperty`
 * above sees own properties only and `Object.isExtensible` only own
 * extensibility, so an ordinary assignment would still walk the prototype chain
 * into an inherited accessor on a user-controlled object: its setter can throw,
 * failing an otherwise successful load, or absorb the write and create nothing,
 * leaving the named export the generated declaration promises resolving to
 * `undefined`. `[[Define]]` consults no prototype, and the descriptor is the one
 * a successful assignment would have produced. The `try` around it covers the
 * one shape that can still refuse — an exotic object such as a `Proxy` whose
 * `defineProperty` trap returns `false` — under the same rule as the
 * non-extensible skip: metadata never fails a load.
 *
 * Every branch that does not throw returns `target`, because the CommonJS emit
 * sites assign the return value —
 * `module.exports.__napiBindingTarget = __napiStampBindingTarget(...)` — rather
 * than calling it as a statement. Node's CJS -> ESM named export detection is
 * `cjs-module-lexer`, a static scanner: it reports `__napiBindingTarget` as a
 * named export only when it can see a `module.exports.<name> =` assignment, and
 * a bare call is invisible to it, so `import { __napiBindingTarget }` from a
 * generated CJS loader stops linking entirely.
 *
 * That assignment always succeeds, and it is never what a consumer reads: its
 * target is the loader's own `module.exports`, an ordinary extensible object,
 * and the alias on the next line replaces it with the binding itself. The value
 * an import resolves to is therefore the one the stamp put on the binding, so
 * when the guard skips — a sealed or frozen exports object — the CommonJS
 * entries report `undefined`. `build.spec.ts` pins exactly that, in `a frozen
 * addon keeps __napiBindingTarget importable, just undefined`. The ESM loaders
 * are unaffected: theirs is a module-level `export const`, not a property of
 * the object they hand out.
 * (`Object.defineProperty` is not an alternative shape for the lexer, whatever
 * it is inside the guard: the lexer matches a literal `module.exports.<name> =`
 * and reports nothing for a data-descriptor `defineProperty` call, so the named
 * import stops linking entirely — measured against Node's own detection.)
 *
 * The assignment target is never the object being stamped. Both CommonJS
 * loaders stamp the addon's exports object but assign onto their own
 * `module.exports`, which they replace with that object afterwards: an addon
 * accessor can report the expected value from a getter and still throw from its
 * setter, and only the guard's `hasOwnProperty`-and-read path is safe to run
 * against it.
 *
 * Placement is the same rule in every loader that stamps a binding object:
 * exactly one stamp, after the async runtime host installation — which hands
 * that object to addon-provided registration functions that may reshape it —
 * and inside the initialization guard that can undo a failed load: the `try`
 * that rolls the WASI environment back, or the one that marks a deferred
 * instance failed.
 *
 * The equal-value short circuit is required, not cosmetic: the root CJS loader
 * aliases the object it loaded, so a `NAPI_RS_NATIVE_LIBRARY_PATH` override
 * that is itself a generated WASI loader — and every WASI fallback candidate —
 * hands back an object already carrying the value about to be stamped.
 *
 * Node 12 compatible (no optional chaining, no nullish coalescing) and valid in
 * both sloppy CJS and strict ESM, because all four loaders emit it verbatim.
 */
export const BINDING_TARGET_STAMP_HELPER = `function ${NAPI_BINDING_TARGET_STAMP_FN}(exportsObject, target) {
  if (
    Object.prototype.hasOwnProperty.call(exportsObject, '${NAPI_BINDING_TARGET_EXPORT}')
  ) {
    if (exportsObject.${NAPI_BINDING_TARGET_EXPORT} === target) {
      // Already ours: the root entry aliases the object it loaded, so a WASI
      // fallback candidate — or a \`NAPI_RS_NATIVE_LIBRARY_PATH\` override that
      // is a generated loader — arrives already stamped with this same value.
      return target
    }
    const error = new Error(
      '\`${NAPI_BINDING_TARGET_EXPORT}\` is reserved by the generated binding loader, but the loaded binding already exports it. Rename the export, e.g. #[napi(js_name = "...")].',
    )
    error.code = '${ERR_NAPI_BINDING_TARGET_CONFLICT}'
    throw error
  }
  if (!Object.isExtensible(exportsObject)) {
    // A \`#[napi(module_exports)]\` hook may seal or freeze this object
    // (\`Object::seal\` / \`Object::freeze\`). Reporting the artifact is metadata,
    // never a reason to fail an otherwise successful load, so the stamp is
    // skipped. What a consumer still sees then follows the entry point: the
    // browser and deferred loaders declare \`${NAPI_BINDING_TARGET_EXPORT}\` at module
    // level and go on reporting it, while the CommonJS entries hand back this
    // very object as \`module.exports\`, so there the value is absent.
    return target
  }
  try {
    // [[Define]], not [[Set]]: an ordinary assignment walks the prototype
    // chain, so an inherited accessor could swallow the value or throw and
    // fail an otherwise successful load. The descriptor is what a successful
    // assignment would have produced.
    Object.defineProperty(exportsObject, '${NAPI_BINDING_TARGET_EXPORT}', {
      configurable: true,
      enumerable: true,
      value: target,
      writable: true,
    })
  } catch {
    // Same rule as the non-extensible skip above: reporting the artifact is
    // metadata, never a reason to fail an otherwise successful load. An exotic
    // object (a Proxy whose defineProperty trap refuses) is skipped, not
    // thrown over.
  }
  // The CommonJS loaders assign this return value so \`cjs-module-lexer\` — and
  // therefore Node's CJS -> ESM named export detection — can see
  // \`${NAPI_BINDING_TARGET_EXPORT}\` statically.
  return target
}`
