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

### Debug mode

```bash
DEBUG="napi:*" napi [command]
```
