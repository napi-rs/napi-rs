# `@napi-rs/cli`

[![Download](https://img.shields.io/npm/dm/@napi-rs/cli)](https://www.npmjs.com/package/@napi-rs/cli)
[![Install size](https://packagephobia.com/badge?p=@napi-rs/cli)](https://packagephobia.com/result?p=@napi-rs/cli)
<a href="https://discord.gg/SpWzYHsKHs">
<img src="https://img.shields.io/discord/874290842444111882.svg?logo=discord&style=flat-square"
    alt="chat" />
</a>

> Cli tools for napi-rs

```sh
# or npm, pnpm
yarn add @napi-rs/cli -D
yarn napi build
```

## Requirements

`@napi-rs/cli` supports Node.js `^20.17.0`, `^22.13.0`, and `>=23.5.0`.
Earlier Node.js releases are no longer supported by the CLI runtime.

## Commands

| Command         | desc                                                           | docs                                                |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| new             | create new napi-rs project                                     | [./docs/new.md](./docs/new.md)                      |
| build           | build napi-rs project                                          | [./docs/build.md](./docs/build.md)                  |
| create-npm-dirs | Create npm package dirs for different platforms                | [./docs/create-npm-dirs](./docs/create-npm-dirs.md) |
| artifacts       | Copy artifacts from Github Actions into specified dir          | [./docs/artifacts.md](./docs/artifacts.md)          |
| rename          | Rename the napi-rs project                                     | [./docs/rename.md](./docs/rename.md)                |
| universalize    | Combile built binaries into one universal binary               | [./docs/universalize.md](./docs/universalize.md)    |
| version         | Update version in created npm packages by `create-npm-dirs`    | [./docs/version.md](./docs/version.md)              |
| pre-publish     | Update package.json and copy addons into per platform packages | [./docs/pre-publish.md](./docs/pre-publish.md)      |

## Disposing generated WASI bindings

Generated WASI bindings expose deterministic cleanup through a non-enumerable
symbol on the binding object:

```js
const binding = require('<package>')
const dispose = binding[Symbol.for('napi.rs.wasi.dispose')]

if (dispose) {
  await dispose()
}
```

The symbol is present only when the loaded binding is WASI. Browser WASI
loaders expose it on their default export. Disposal releases the instance: it
destroys the emnapi context and then terminates the workers owned by that
binding. Before that, the loader calls the binary's
`napi_prepare_wasm_env_cleanup` preparation hook, which shuts the addon's async
runtime down while the environment can still call into JavaScript. A registered
`AsyncRuntime` backend quiesces there and its cancelled tasks reject their
promises; the built-in Tokio runtime only _starts_ draining, so with it a
promise whose task is still running can still be left pending. Settle in-flight
work before disposing if that matters.

The same preparation runs on a direct `Context.destroy()`. `destroy()` disables
JavaScript calls before it runs its cleanup hooks, and the threadsafe function's
hook then drops whatever is still queued, so every generated loader shadows
`destroy` on the emnapi context it creates: an embedder, a test harness, or
emnapi's own `beforeExit` auto-destroy gets the barrier too, instead of silently
discarding the settlements. Prefer the dispose symbol when you can yield — only
`dispose()` waits for settlements queued from another thread. A `destroy()` that
re-enters from a promise hook while the barrier is still running is a no-op,
because the frame that started the barrier destroys the moment it returns; a
`dispose()` that re-enters the same way joins the disposal already running,
since its frame yields for the settlement drain before it destroys.

Concurrent calls share one promise, successful disposal is idempotent, and a
failed cleanup phase can be retried by calling the same function again. Do not
call addon exports after disposal completes.

See [WASI targets and loaders](./docs/wasi.md) for threaded, threadless,
browser, and workerd packaging behavior.

### Debug mode

```bash
DEBUG="napi:*" napi [command]
```
