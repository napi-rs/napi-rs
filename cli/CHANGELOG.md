# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [3.0.0-alpha.8](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@3.0.0-alpha.7...@napi-rs/cli@3.0.0-alpha.8) (2023-11-20)

**Note:** Version bump only for package @napi-rs/cli

# [3.0.0-alpha.7](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@3.0.0-alpha.6...@napi-rs/cli@3.0.0-alpha.7) (2023-11-08)

### Bug Fixes

- **cli:** artifacts command backward compatibility ([#1797](https://github.com/napi-rs/napi-rs/issues/1797)) ([6ec46b7](https://github.com/napi-rs/napi-rs/commit/6ec46b749e74e7de1e4ec1c612d1a2be888cc52f))
- **cli:** wrong wasm file name with --platform flag ([#1798](https://github.com/napi-rs/napi-rs/issues/1798)) ([8ddd35c](https://github.com/napi-rs/napi-rs/commit/8ddd35c7880d436bad95f294c69778081590eb3a))

# [3.0.0-alpha.6](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@3.0.0-alpha.5...@napi-rs/cli@3.0.0-alpha.6) (2023-11-07)

### Bug Fixes

- **cli:** js binding template ([#1788](https://github.com/napi-rs/napi-rs/issues/1788)) ([dac0738](https://github.com/napi-rs/napi-rs/commit/dac073805bd469b6a75ba0e12dc402d82608f296))
- **cli:** pick right android tools while cross compiling ([#1675](https://github.com/napi-rs/napi-rs/issues/1675)) ([f2f4b48](https://github.com/napi-rs/napi-rs/commit/f2f4b48e8aa311b5670e972f4d0fde3e34803d39))
- **cli:** set RANLIB while building android targets ([5d0240e](https://github.com/napi-rs/napi-rs/commit/5d0240e8ad90af18bdf426b3b00f023c03505f30))
- **cli:** switch name parsing to allow periods in name ([fcb5c2b](https://github.com/napi-rs/napi-rs/commit/fcb5c2bdd0239c47eec95aa3af94417e9d495995))

### Features

- **cli:** add provenance to ci template ([#1671](https://github.com/napi-rs/napi-rs/issues/1671)) ([9ebe404](https://github.com/napi-rs/napi-rs/commit/9ebe404e9a4ec068d66d7011d3bc1fbd52c23325))
- integrate with emnapi ([#1669](https://github.com/napi-rs/napi-rs/issues/1669)) ([13d0ce0](https://github.com/napi-rs/napi-rs/commit/13d0ce075e8b10702d675db2f45a721eac0dd30d))

### Performance Improvements

- **cli:** improve musl verification ([#1660](https://github.com/napi-rs/napi-rs/issues/1660)) ([3ee6be4](https://github.com/napi-rs/napi-rs/commit/3ee6be4e5f97a431735d12b610c8851d549c68b2))

# [3.0.0-alpha.5](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@3.0.0-alpha.3...@napi-rs/cli@3.0.0-alpha.5) (2023-07-18)

### Bug Fixes

- **cli:** add back override cargo by env ([#1605](https://github.com/napi-rs/napi-rs/issues/1605)) ([e60b1a5](https://github.com/napi-rs/napi-rs/commit/e60b1a599b8f3649cafc2908d974565ac95eec2f))
- **cli:** created template missing macOS testing ([#1659](https://github.com/napi-rs/napi-rs/issues/1659)) ([4e0c9b1](https://github.com/napi-rs/napi-rs/commit/4e0c9b14e449beb8aa6872b8b85db922535a3eca))
- **cli:** incorrect behaviors ([#1626](https://github.com/napi-rs/napi-rs/issues/1626)) ([fb22a5a](https://github.com/napi-rs/napi-rs/commit/fb22a5ae07a53ce0eace25fdd3831ecf899dd654))
- **cli:** revert back js-binding file ([#1603](https://github.com/napi-rs/napi-rs/issues/1603)) ([82c2113](https://github.com/napi-rs/napi-rs/commit/82c2113c242b48c62e651791528559f039852255))
- **deps:** update dependency @octokit/rest to v20 ([#1653](https://github.com/napi-rs/napi-rs/issues/1653)) ([f610129](https://github.com/napi-rs/napi-rs/commit/f610129b112fd07c721d5e91fa0b4111a970290e))

### Features

- **cli:** add --use-cross command for building with `cross` ([#1584](https://github.com/napi-rs/napi-rs/issues/1584)) ([5860088](https://github.com/napi-rs/napi-rs/commit/58600883dd6ac69b8ffd1e51d7c5b00adcc09c33)), closes [#1582](https://github.com/napi-rs/napi-rs/issues/1582)
- **cli:** detect Cargo `--profile` argument ([#1598](https://github.com/napi-rs/napi-rs/issues/1598)) ([8583603](https://github.com/napi-rs/napi-rs/commit/85836034ff522dedcd694debd2e0e2046aa97776))
- **target:** riscv64gc-unknown-linux-gnu ([72fcd03](https://github.com/napi-rs/napi-rs/commit/72fcd03d982e2926bcc623061bbf287e2990f1e1))

# [3.0.0-alpha.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@3.0.0-alpha.2...@napi-rs/cli@3.0.0-alpha.3) (2023-04-07)

### Bug Fixes

- **cli:** incorrect new project template content ([7fcd68f](https://github.com/napi-rs/napi-rs/commit/7fcd68f14d0bd3b278abefd88d08ecb508f25f50))

# [3.0.0-alpha.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@3.0.0-alpha.1...@napi-rs/cli@3.0.0-alpha.2) (2023-04-06)

**Note:** Version bump only for package @napi-rs/cli

# [3.0.0-alpha.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@3.0.0-alpha.0...@napi-rs/cli@3.0.0-alpha.1) (2023-04-06)

### Bug Fixes

- **cli:** missing shebang prefix in cli entries ([e4c4a5f](https://github.com/napi-rs/napi-rs/commit/e4c4a5fe5df7abfdbae1ce5e19e686b55624a283))

# [3.0.0-alpha.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.15.2...@napi-rs/cli@3.0.0-alpha.0) (2023-04-06)

### Features

- **cli:** brand new cli tool with both cli and programmatical usage ([#1492](https://github.com/napi-rs/napi-rs/issues/1492)) ([a781a4f](https://github.com/napi-rs/napi-rs/commit/a781a4f27e19ffaf3e42a470a6d4a990c34c9e3b))

### BREAKING CHANGES

- **cli:** requires node >= 16 and some cli options have been renamed

## [2.15.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.15.1...@napi-rs/cli@2.15.2) (2023-03-22)

### Bug Fixes

- **cli,napi-derive:** backward compatible with older cli with [#1531](https://github.com/napi-rs/napi-rs/issues/1531) ([#1536](https://github.com/napi-rs/napi-rs/issues/1536)) ([5398b16](https://github.com/napi-rs/napi-rs/commit/5398b16238dfc04562376d66d502d78357198c2f))

## [2.15.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.15.0...@napi-rs/cli@2.15.1) (2023-03-21)

### Bug Fixes

- **cli,napi-derive:** re-export types from shared crate ([#1531](https://github.com/napi-rs/napi-rs/issues/1531)) ([3d48d44](https://github.com/napi-rs/napi-rs/commit/3d48d4464bd3b5c7866183bad007fcc9269d8721))
- **cli:** dts pipe ([#1532](https://github.com/napi-rs/napi-rs/issues/1532)) ([0f0837f](https://github.com/napi-rs/napi-rs/commit/0f0837f5ca4b2938aa316b91cb7aacb6446e4fe8))

# [2.15.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.14.8...@napi-rs/cli@2.15.0) (2023-03-21)

### Bug Fixes

- **cli:** export non const enums when generating typedefs ([#1527](https://github.com/napi-rs/napi-rs/issues/1527)) ([c8bd892](https://github.com/napi-rs/napi-rs/commit/c8bd8924e220ac39cfc29cf9e0e18eee6c36a912))

### Features

- export registers in wasm32 target ([#1529](https://github.com/napi-rs/napi-rs/issues/1529)) ([550ef7c](https://github.com/napi-rs/napi-rs/commit/550ef7c3ccd56ea5b06a9cc90a5363d83105b8b7))

## [2.14.8](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.14.7...@napi-rs/cli@2.14.8) (2023-02-16)

### Bug Fixes

- **cli:** always generate typedef file even native code never changes ([#1489](https://github.com/napi-rs/napi-rs/issues/1489)) ([7281f53](https://github.com/napi-rs/napi-rs/commit/7281f533bd73d6c6255244c9f1556a0e39c47738))

## [2.14.7](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.14.6...@napi-rs/cli@2.14.7) (2023-02-08)

### Bug Fixes

- **cli:** JS bindgen file now respects destDir ([#1481](https://github.com/napi-rs/napi-rs/issues/1481)) ([cb529d2](https://github.com/napi-rs/napi-rs/commit/cb529d21cf92dfaa279bfe10dde5ad87441b47ba))

## [2.14.6](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.14.5...@napi-rs/cli@2.14.6) (2023-02-02)

**Note:** Version bump only for package @napi-rs/cli

## [2.14.5](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.14.4...@napi-rs/cli@2.14.5) (2023-01-29)

### Bug Fixes

- **cli:** upload GitHub assets issue ([a302c9c](https://github.com/napi-rs/napi-rs/commit/a302c9cb18710d8d71045d11780f09d4eaf1ecde))

## [2.14.4](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.14.3...@napi-rs/cli@2.14.4) (2023-01-20)

### Bug Fixes

- **napi:** build error with zig@0.10.1 ([2f52793](https://github.com/napi-rs/napi-rs/commit/2f527938b27074116a89b9248e218a2ed073be34))

## [2.14.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.14.1...@napi-rs/cli@2.14.2) (2023-01-10)

### Bug Fixes

- **cli:** CARGO env var ([#1426](https://github.com/napi-rs/napi-rs/issues/1426)) ([cc53807](https://github.com/napi-rs/napi-rs/commit/cc53807fe263060ecf76848a0c9ff61717762f77))

## [2.14.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.14.0...@napi-rs/cli@2.14.1) (2023-01-03)

### Bug Fixes

- **cli:** android cmake build ([895e4ca](https://github.com/napi-rs/napi-rs/commit/895e4caf952de3dbe4989435fdb566088c801c30))
- **cli:** quote toml path ([#1410](https://github.com/napi-rs/napi-rs/issues/1410)) ([c58972e](https://github.com/napi-rs/napi-rs/commit/c58972ee0a1ebc1abfd684f125735964caea1384))

# [2.14.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.3...@napi-rs/cli@2.14.0) (2022-12-25)

### Features

- **cli:** add --zig-link-only option ([#1400](https://github.com/napi-rs/napi-rs/issues/1400)) ([bc41c97](https://github.com/napi-rs/napi-rs/commit/bc41c9778f152aba9663b105f8259c3a3bb692a2))

## [2.13.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.2...@napi-rs/cli@2.13.3) (2022-12-15)

### Bug Fixes

- **cli:** set cmake toolchain for android cross build ([#1394](https://github.com/napi-rs/napi-rs/issues/1394)) ([f2c10af](https://github.com/napi-rs/napi-rs/commit/f2c10affee0f8250e3b695d85aa3e3c8c8c791fd))
- **cli:** template to works with nix ([#1391](https://github.com/napi-rs/napi-rs/issues/1391)) ([36a897e](https://github.com/napi-rs/napi-rs/commit/36a897e27a6093be69710f8c61dfbea29975cb9b))

## [2.13.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.1...@napi-rs/cli@2.13.2) (2022-12-09)

### Bug Fixes

- **cli:** ci template upgrade ([bd1d3fe](https://github.com/napi-rs/napi-rs/commit/bd1d3fe0a6d1ce5f237f51ac81704e60c584b6f2))

## [2.13.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.0...@napi-rs/cli@2.13.1) (2022-12-09)

### Bug Fixes

- **cli:** zig cross armv7 ([#1384](https://github.com/napi-rs/napi-rs/issues/1384)) ([2abc946](https://github.com/napi-rs/napi-rs/commit/2abc94681ecc1010106ae4e2a9c076a9e964094d))

# [2.13.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.12.1...@napi-rs/cli@2.13.0) (2022-11-20)

### Features

- **cli:** auto choose the tooling for cross compiling ([#1367](https://github.com/napi-rs/napi-rs/issues/1367)) ([696c2dd](https://github.com/napi-rs/napi-rs/commit/696c2ddcd841d416f53a8917fc55cf893d3a0642))

# [2.13.0-alpha.6](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.0-alpha.5...@napi-rs/cli@2.13.0-alpha.6) (2022-11-20)

**Note:** Version bump only for package @napi-rs/cli

# [2.13.0-alpha.5](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.0-alpha.4...@napi-rs/cli@2.13.0-alpha.5) (2022-11-20)

**Note:** Version bump only for package @napi-rs/cli

# [2.13.0-alpha.4](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.0-alpha.3...@napi-rs/cli@2.13.0-alpha.4) (2022-11-20)

**Note:** Version bump only for package @napi-rs/cli

# [2.13.0-alpha.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.0-alpha.2...@napi-rs/cli@2.13.0-alpha.3) (2022-11-20)

**Note:** Version bump only for package @napi-rs/cli

# [2.13.0-alpha.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.0-alpha.1...@napi-rs/cli@2.13.0-alpha.2) (2022-11-17)

**Note:** Version bump only for package @napi-rs/cli

# [2.13.0-alpha.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.13.0-alpha.0...@napi-rs/cli@2.13.0-alpha.1) (2022-11-17)

**Note:** Version bump only for package @napi-rs/cli

# [2.13.0-alpha.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.12.1...@napi-rs/cli@2.13.0-alpha.0) (2022-11-17)

### Features

- **cli:** auto choose the tooling for cross compiling ([7faf4fc](https://github.com/napi-rs/napi-rs/commit/7faf4fc4cc3b2e9dc47c892a9acf9bcf7e0571ad))

## [2.12.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.12.0...@napi-rs/cli@2.12.1) (2022-11-12)

### Bug Fixes

- **cli:** compatible with zig 0.10.0 ([32cf02e](https://github.com/napi-rs/napi-rs/commit/32cf02e633030bc46ec963d47b0e11dd17f89cda))
- **cli:** incorrent version without npm folder ([caeef4a](https://github.com/napi-rs/napi-rs/commit/caeef4a6757a811d23bb76bd2c441587178ec6f5))
- **cli:** support help command ([#1355](https://github.com/napi-rs/napi-rs/issues/1355)) ([7f82c95](https://github.com/napi-rs/napi-rs/commit/7f82c95525a7619b5baadca6cfc1bd0f98213244))

# [2.12.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.11.4...@napi-rs/cli@2.12.0) (2022-10-04)

### Bug Fixes

- **cli:** custom Cargo (build) target directories ([#1300](https://github.com/napi-rs/napi-rs/issues/1300)) ([f7c26cc](https://github.com/napi-rs/napi-rs/commit/f7c26cccbffa12879f2c2f8331b66bec8582d4de))

### Features

- **cli:** parse `Cargo.toml` using `cargo metadata` ([#1330](https://github.com/napi-rs/napi-rs/issues/1330)) ([4279291](https://github.com/napi-rs/napi-rs/commit/4279291f4ba9848b92f62b0fb496fe436fa5256c))
- **napi-derive:** catch_unwind attribute ([#1280](https://github.com/napi-rs/napi-rs/issues/1280)) ([b7a3103](https://github.com/napi-rs/napi-rs/commit/b7a3103f0c80eef19d9fe653f3bc7fdd14f90df1))

## [2.11.4](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.11.3...@napi-rs/cli@2.11.4) (2022-08-12)

### Bug Fixes

- **cli:** zig cross to \*-apple-darwin target ([14aab06](https://github.com/napi-rs/napi-rs/commit/14aab065e7e7f3fe927d1dbb72bce8a8d419b711))

## [2.11.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.11.2...@napi-rs/cli@2.11.3) (2022-08-12)

### Bug Fixes

- **cli:** ignore preinstall scripts on FreeBSD while installing yarn ([1d1ef3d](https://github.com/napi-rs/napi-rs/commit/1d1ef3d69eb5be24896e8c2c50499c8cc7a5471d))

## [2.11.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.11.1...@napi-rs/cli@2.11.2) (2022-08-12)

### Bug Fixes

- **cli:** npm i -g flag is deprecated ([9b9cd5d](https://github.com/napi-rs/napi-rs/commit/9b9cd5d23b0f3be01b8b42bc808f96557c6e22e0))

## [2.11.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.11.0...@napi-rs/cli@2.11.1) (2022-08-09)

### Bug Fixes

- **cli:** add .yarn and **test** folder to .npmignore ([1cf5a0d](https://github.com/napi-rs/napi-rs/commit/1cf5a0dc75c99628095cae0262fc47693fa08b63))

## [2.11.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.10.3...@napi-rs/cli@2.11.0) (2022-08-07)

- feat(cli): support npmClient config by @Brooooooklyn in https://github.com/napi-rs/napi-rs/pull/1253
- feat(cli): use `CARGO_TARGET_DIR` if set by @amrbashir in https://github.com/napi-rs/napi-rs/pull/1251
- chore(cli): improve `-.node` doesn't exist warning msg wording by @amrbashir in https://github.com/napi-rs/napi-rs/pull/1254
- feat(cli): add an option to specify the github release name by @amrbashir in https://github.com/napi-rs/napi-rs/pull/1255
- feat(cli): allow specifying an existing release by @amrbashir in https://github.com/napi-rs/napi-rs/pull/1256

## [2.10.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.10.2...@napi-rs/cli@2.10.3) (2022-07-27)

### Bug Fixes

- **cli:** android build due to GitHub Actions environments change ([fd2060b](https://github.com/napi-rs/napi-rs/commit/fd2060baa49c1e7f815f9d95f79fdd8a496afba7))

## [2.10.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.10.1...@napi-rs/cli@2.10.2) (2022-07-22)

### Bug Fixes

- **cli:** upgrade freebsd ci ([ed5fd40](https://github.com/napi-rs/napi-rs/commit/ed5fd4083c16832d01ce7c843f6b3c2acf2290a4))

## [2.10.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.10.0...@napi-rs/cli@2.10.1) (2022-07-06)

### Bug Fixes

- **cli:** android CI template ([227de9e](https://github.com/napi-rs/napi-rs/commit/227de9efe0ff883af48be29996d436a185bc7ca6))

# [2.10.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.9.0...@napi-rs/cli@2.10.0) (2022-06-10)

### Bug Fixes

- **cli:** parse host target triple from `rustc -vV` ([#1191](https://github.com/napi-rs/napi-rs/issues/1191)) ([beb7511](https://github.com/napi-rs/napi-rs/commit/beb75111fcf46f60edfc00d83f6141a67f145cb3))

### Features

- **cli:** upgrade new project template to yarn3 ([8f6a10c](https://github.com/napi-rs/napi-rs/commit/8f6a10c89a33cc61655ee204684d5535b51dd931))

# [2.9.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.8.0...@napi-rs/cli@2.9.0) (2022-05-14)

### Features

- **cli:** allow specifying an alternative cargo binary via `CARGO` env var ([#1181](https://github.com/napi-rs/napi-rs/issues/1181)) ([1399288](https://github.com/napi-rs/napi-rs/commit/1399288df5b16fd615b2b0a5a24f72ac602635a4))

# [2.8.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.8.0-alpha.0...@napi-rs/cli@2.8.0) (2022-05-07)

**Note:** Version bump only for package @napi-rs/cli

# [2.8.0-alpha.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.7.0...@napi-rs/cli@2.8.0-alpha.0) (2022-05-06)

### Features

- **cli:** new command upgrade ([652aa3c](https://github.com/napi-rs/napi-rs/commit/652aa3cc57c6f4d5b72491f1ad3fc44ac8ab7780))

# [2.7.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.6.2...@napi-rs/cli@2.7.0) (2022-04-27)

### Bug Fixes

- **cli:** generated type def on multi impl blocks ([c3a35a0](https://github.com/napi-rs/napi-rs/commit/c3a35a070440b1253c172a0e5e4be0a018206946))

### Features

- **cli:** add build option to not include the header in dts file ([#1140](https://github.com/napi-rs/napi-rs/issues/1140)) ([c390609](https://github.com/napi-rs/napi-rs/commit/c39060984d4cae560da7c1a7994ba6c1e33fa101))

## [2.6.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.6.1...@napi-rs/cli@2.6.2) (2022-04-01)

### Bug Fixes

- cargo metadata with large project ([#1117](https://github.com/napi-rs/napi-rs/issues/1117)) ([6bef28a](https://github.com/napi-rs/napi-rs/commit/6bef28a59bcfe3850f8d31d6eeaffdba5c251050))

## [2.6.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.6.0...@napi-rs/cli@2.6.1) (2022-04-01)

### Bug Fixes

- **cli:** should not throw if cargoName is provided but no package.name ([8700da1](https://github.com/napi-rs/napi-rs/commit/8700da17763ed5c9fd5ddda8f7a8af4d922ecbed))

# [2.6.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.4.5...@napi-rs/cli@2.6.0) (2022-04-01)

### Bug Fixes

- **cli:** prevent crash if GITHUB_REPOSITORY is not specified ([ac8406c](https://github.com/napi-rs/napi-rs/commit/ac8406c8428227a1ee45c2b4606cc09eae6f44c5))
- **cli:** respect CARGO_BUILD_TARGET env variable ([bd08787](https://github.com/napi-rs/napi-rs/commit/bd0878727036678eca984e754a1eeda9915f4042))
- **cli:** use shell file path instead of commands for zig CC and CXX ([09ccfaa](https://github.com/napi-rs/napi-rs/commit/09ccfaad1d3c1fd00784aae4a2206366ea3123e8))

### Features

- **cli:** add libc filed in native package.json ([ee0279e](https://github.com/napi-rs/napi-rs/commit/ee0279e540238683a8f43cb92ef790e10a3591d9))
- **cli:** add support for building binaries ([20b1edc](https://github.com/napi-rs/napi-rs/commit/20b1edc53b38fe3b4cf3c628351fcdfcdeff8037))
- **cli:** upgrade ci.yml templates ([1cac0ac](https://github.com/napi-rs/napi-rs/commit/1cac0ac804d526932ccd1c24602976c7ce564a4e))

# [2.5.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.4.5...@napi-rs/cli@2.5.0) (2022-03-22)

### Bug Fixes

- **cli:** use shell file path instead of commands for zig CC and CXX ([09ccfaa](https://github.com/napi-rs/napi-rs/commit/09ccfaad1d3c1fd00784aae4a2206366ea3123e8))

### Features

- **cli:** add libc filed in native package.json ([ee0279e](https://github.com/napi-rs/napi-rs/commit/ee0279e540238683a8f43cb92ef790e10a3591d9))
- **cli:** upgrade ci.yml templates ([1cac0ac](https://github.com/napi-rs/napi-rs/commit/1cac0ac804d526932ccd1c24602976c7ce564a4e))

## [2.4.5](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.4.4...@napi-rs/cli@2.4.5) (2022-03-05)

### Bug Fixes

- **cli:** temporary dts path may not be writable ([e69f023](https://github.com/napi-rs/napi-rs/commit/e69f0230c24cb74d55287fe191d05edf53d7830a))
- **napi:** race issues with Node.js worker_thread ([#1081](https://github.com/napi-rs/napi-rs/issues/1081)) ([9f3fbaa](https://github.com/napi-rs/napi-rs/commit/9f3fbaa8e0b6c0bcdd740d39d16de35a4ec18aa8))

## [2.4.4](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.4.3...@napi-rs/cli@2.4.4) (2022-02-11)

### Bug Fixes

- **cli:** generate ExternalObject type on demand ([f9c618e](https://github.com/napi-rs/napi-rs/commit/f9c618e0462c3f75593b0a980f4babcb265ffc0c))

## [2.4.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.4.2...@napi-rs/cli@2.4.3) (2022-02-09)

### Bug Fixes

- **cli:** compatible for Node.js 10x ([5f359df](https://github.com/napi-rs/napi-rs/commit/5f359dfaae809a2b97a25b8ed12914152a9696d9))

## [2.4.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.4.1...@napi-rs/cli@2.4.2) (2022-01-19)

### Bug Fixes

- **cli:** js binding template ([25f6754](https://github.com/napi-rs/napi-rs/commit/25f6754a71dfa4736c75eb91bf9f2562543f5d08))

## [2.4.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.4.0...@napi-rs/cli@2.4.1) (2022-01-18)

### Bug Fixes

- **cli:** missing shebang in zig-cross sh file ([63a16d0](https://github.com/napi-rs/napi-rs/commit/63a16d0a27f09766a6dd557691d598758a147882))
- **cli:** properly handle RUSTFLAGS env var ([d84cbe8](https://github.com/napi-rs/napi-rs/commit/d84cbe88bdcaadbc0b57c6b49b9d84e22020cf34))
- **cli:** swap -lgcc_s with -lunwind ([1799aa9](https://github.com/napi-rs/napi-rs/commit/1799aa94e3132c425cfc47413b7c254d7f8f711e))

# [2.4.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.3.1...@napi-rs/cli@2.4.0) (2022-01-13)

### Bug Fixes

- **cli:** zig abi should pass to linker ([95d49f8](https://github.com/napi-rs/napi-rs/commit/95d49f8cf4485fcf8a882291b9bd64d5667668c6))

### Features

- **cli:** add `--strip` option for removing symbols ([887bdb9](https://github.com/napi-rs/napi-rs/commit/887bdb9d2908576f5d3468cfdcf662538f1fbe8d))

## [2.3.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.3.0...@napi-rs/cli@2.3.1) (2022-01-13)

### Bug Fixes

- **cli:** missing zig-abi-suffix support ([472ac10](https://github.com/napi-rs/napi-rs/commit/472ac10c67b7b239bb9bfcc3a1e897508cfc3314))

# [2.3.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.2.1...@napi-rs/cli@2.3.0) (2022-01-06)

### Features

- **cli:** support macOS with --zig flag ([0db94cc](https://github.com/napi-rs/napi-rs/commit/0db94ccd669d095321a544a195f30fde6af71eec))

## [2.2.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.2.0...@napi-rs/cli@2.2.1) (2022-01-04)

### Bug Fixes

- **cli:** fix crate-type hint ([894334e](https://github.com/napi-rs/napi-rs/commit/894334e8f1ba138d029cc861dfc836edc95c17d3))
- **cli:** handle lld not found ([eb79cce](https://github.com/napi-rs/napi-rs/commit/eb79ccebbeb0f9d1a3b4f4eff5e9a7271ff6f431))
- **cli:** shell: true instead of bash ([bc570c2](https://github.com/napi-rs/napi-rs/commit/bc570c29183f20139f8a80aa54d219cc1a590a2b))
- **napi-derive,cli:** export type alias for original name ([556ace8](https://github.com/napi-rs/napi-rs/commit/556ace8f3302d9dd0b5aec237c3aa49caf58d7dd))
- **napi-derive:** return instance from non-default constructor class ([e6a30ff](https://github.com/napi-rs/napi-rs/commit/e6a30ffcca38f1b6d72211931f32675a53f12dcf))

# [2.2.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.1.0...@napi-rs/cli@2.2.0) (2021-12-22)

### Features

- **cli:** provide a way to override the native package name ([046f75d](https://github.com/napi-rs/napi-rs/commit/046f75dc29f8ea2319311006b2743749427d7ed4))

# [2.1.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0...@napi-rs/cli@2.1.0) (2021-12-21)

### Bug Fixes

- **cli:** disable js binding generation if no --platform flag ([f577512](https://github.com/napi-rs/napi-rs/commit/f577512952b0409ab76422ce539872af16a98d77))
- keep .d.ts and .js untouched if native doesn't change ([09c7df3](https://github.com/napi-rs/napi-rs/commit/09c7df3c5ce612736011079ddaffa5701522d811))

### Features

- **napi:** add ts typegen skip ([df9dc91](https://github.com/napi-rs/napi-rs/commit/df9dc91562e648b21eaa97bae9f2c9354ed1b976))

# [2.0.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-beta.5...@napi-rs/cli@2.0.0) (2021-12-17)

**Note:** Version bump only for package @napi-rs/cli

# [2.0.0-beta.5](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-beta.4...@napi-rs/cli@2.0.0-beta.5) (2021-12-10)

### Bug Fixes

- **cli:** enum TypeScript type should be const enum ([f4b0a2e](https://github.com/napi-rs/napi-rs/commit/f4b0a2e3228eb9d6d2c8f51e31d250930799ce1d))
- **cli:** preserve authors field while creating npm dir ([ecb6522](https://github.com/napi-rs/napi-rs/commit/ecb6522f508688e982d3649218334df4228d6edd))

### Features

- **cli:** provide rename command to rename everything in package-template project ([b977265](https://github.com/napi-rs/napi-rs/commit/b977265cfa06a1e33cca4b2579b561ed73f8a1b1))

# [2.0.0-beta.4](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-beta.3...@napi-rs/cli@2.0.0-beta.4) (2021-12-07)

### Features

- **cli:** workaround for Windows i686 ICE in dev mode ([11a5a35](https://github.com/napi-rs/napi-rs/commit/11a5a35485853c722d55dca32a6c3175ecdea8fb))

### Reverts

- Revert "build(deps): bump chalk from 4.1.2 to 5.0.0" ([8b362d8](https://github.com/napi-rs/napi-rs/commit/8b362d8eb1fcb3028e6621bf6f889890b97f28a9))

# [2.0.0-beta.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-beta.2...@napi-rs/cli@2.0.0-beta.3) (2021-12-03)

### Features

- **napi:** add -p flag which will be bypassed to cargo ([8de30a9](https://github.com/napi-rs/napi-rs/commit/8de30a9287b3586efe81edf4f2745032c07b298a))

# [2.0.0-beta.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-beta.1...@napi-rs/cli@2.0.0-beta.2) (2021-12-02)

### Bug Fixes

- **cli:** android armv7 CI config in new command ([d495cc1](https://github.com/napi-rs/napi-rs/commit/d495cc11f805e0c85327850f25d91e1d58c48ff2))

# [2.0.0-beta.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-beta.0...@napi-rs/cli@2.0.0-beta.1) (2021-12-02)

### Bug Fixes

- **cli:** missing exported enum ([d58e488](https://github.com/napi-rs/napi-rs/commit/d58e488fa210d83e8cac814ff207403d51a532ab))

# [2.0.0-beta.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.12...@napi-rs/cli@2.0.0-beta.0) (2021-12-02)

### Features

- **cli:** fail the pipeline if artifacts not been built ([5f22203](https://github.com/napi-rs/napi-rs/commit/5f222038d316b5e5b6ca2a1debd69e7c26843704))
- **cli:** support android armv7 target ([68b0483](https://github.com/napi-rs/napi-rs/commit/68b0483c81c5cbddc7b0294ae36772701549cbe2))
- **napi:** support TypedArray input and output ([d9c53d7](https://github.com/napi-rs/napi-rs/commit/d9c53d728be02b01f0e2ff19845cd652068f9303))

# [2.0.0-alpha.12](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.11...@napi-rs/cli@2.0.0-alpha.12) (2021-11-30)

### Features

- **napi:** output Rust doc comments in definitions as jsdoc comments ([18d2743](https://github.com/napi-rs/napi-rs/commit/18d2743862819a35261cc70556e44fbcfe8bb47d))

# [2.0.0-alpha.11](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.10...@napi-rs/cli@2.0.0-alpha.11) (2021-11-25)

### Features

- **napi:** support export rust mod as ts namespace ([1fe39ff](https://github.com/napi-rs/napi-rs/commit/1fe39ff66dceaacca7b99207e13ae1ab8f7bdf39))

# [2.0.0-alpha.10](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.9...@napi-rs/cli@2.0.0-alpha.10) (2021-11-21)

### Features

- **cli:** create pre-release if tag includes alpha/beta/rc ([7b797d3](https://github.com/napi-rs/napi-rs/commit/7b797d3caf2d7beaa8d48b73a585e5c4f4400532))

# [2.0.0-alpha.9](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.8...@napi-rs/cli@2.0.0-alpha.9) (2021-11-21)

### Bug Fixes

- **cli:** wrong release assets content ([458c5c9](https://github.com/napi-rs/napi-rs/commit/458c5c94574a6ee3563bc8c9953f09b74d794bdc))

# [2.0.0-alpha.8](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.7...@napi-rs/cli@2.0.0-alpha.8) (2021-11-21)

### Features

- **cli:** export android toolchains to PATH before build ([dca5ada](https://github.com/napi-rs/napi-rs/commit/dca5ada9959adb52db073c89f2823908d57c2a51))

# [2.0.0-alpha.7](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.6...@napi-rs/cli@2.0.0-alpha.7) (2021-11-21)

### Bug Fixes

- **cli:** ExternalObject type decalare ([1f64f9f](https://github.com/napi-rs/napi-rs/commit/1f64f9fbf3c9c36ea0f3a843a4754443d2d37daa))

# [2.0.0-alpha.6](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.5...@napi-rs/cli@2.0.0-alpha.6) (2021-11-21)

### Features

- **cli:** refactor cli build ([4c3fe26](https://github.com/napi-rs/napi-rs/commit/4c3fe2647871ca8eede3097235b8ff9acbe64d17))
- **napi:** implement external value ([bdfb150](https://github.com/napi-rs/napi-rs/commit/bdfb1506a22d67633ef26db49a0e1b683cad9c19))

# [2.0.0-alpha.5](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.4...@napi-rs/cli@2.0.0-alpha.5) (2021-11-16)

### Bug Fixes

- always add a newline at the end of the file when generating js-binding.js ([753bb1e](https://github.com/napi-rs/napi-rs/commit/753bb1e31b375bb546523d372bcc0a079bae3ed5))

### Features

- **napi:** add pipe flag to pipe the generated files into custom command ([e37c3fd](https://github.com/napi-rs/napi-rs/commit/e37c3fd9089d13c7ee34109ad779b50c77f1b761))

# [2.0.0-alpha.4](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.3...@napi-rs/cli@2.0.0-alpha.4) (2021-11-09)

### Features

- **cli:** generate js binding to avoid dynamic require logic ([179f20a](https://github.com/napi-rs/napi-rs/commit/179f20a7c5d2b71bc0a0825816092390291ce23d))

# [2.0.0-alpha.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.2...@napi-rs/cli@2.0.0-alpha.3) (2021-10-27)

### Bug Fixes

- **cli:** workflow file generated by new command ([cbb71a9](https://github.com/napi-rs/napi-rs/commit/cbb71a9a516058afddb343be6a768201c2735e30))

# [2.0.0-alpha.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@2.0.0-alpha.1...@napi-rs/cli@2.0.0-alpha.2) (2021-10-01)

### Features

- **cli:** strip android binary in CI ([1c9a307](https://github.com/napi-rs/napi-rs/commit/1c9a307dc9accd4a69aac0d1b19e77b1e3b6c086))

# [2.0.0-alpha.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.3.3...@napi-rs/cli@2.0.0-alpha.1) (2021-10-01)

### Bug Fixes

- **cli:** missing main and types field in created package.json ([860a02a](https://github.com/napi-rs/napi-rs/commit/860a02a7cb575d8a33c2007ad38eda762e12ba79))

### Features

- **cli:** dts flag for build command ([0e8de17](https://github.com/napi-rs/napi-rs/commit/0e8de173a4519c70ab9fcf9a4e0ec01aaca64d97))

# 2.0.0-alpha.0 (2021-09-22)

## [1.3.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.3.2...@napi-rs/cli@1.3.3) (2021-09-19)

### Bug Fixes

- **cli:** version of binary optional dependencies should be pinned ([27dbca8](https://github.com/napi-rs/napi-rs/commit/27dbca814c90bacbbb54e75a66eee56cb7372324))

## [1.3.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.3.1...@napi-rs/cli@1.3.2) (2021-09-14)

### Bug Fixes

- **cli:** cargo config path and ci template in new command ([c385254](https://github.com/napi-rs/napi-rs/commit/c3852543a59a945686464040dbb6e4109a51e400))

## [1.3.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.3.0...@napi-rs/cli@1.3.1) (2021-09-02)

### Bug Fixes

- **cli:** ci template ([45d3e68](https://github.com/napi-rs/napi-rs/commit/45d3e68ff3307546de46650443fd8db0906a7856))
- **cli:** missed inquirer dependency ([c303f35](https://github.com/napi-rs/napi-rs/commit/c303f358efc0cd66b0e5505749953fa8e536b7af))

# [1.3.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.2.1...@napi-rs/cli@1.3.0) (2021-09-01)

### Features

- **cli:** add back new command ([2c23f44](https://github.com/napi-rs/napi-rs/commit/2c23f444b09fbecef21e36a22a35e472cecb9cd2))

## [1.2.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.2.0...@napi-rs/cli@1.2.1) (2021-08-09)

### Bug Fixes

- **cli:** create dist dir if not existed while building ([e90ea93](https://github.com/napi-rs/napi-rs/commit/e90ea9304a2a3180148f7e8f9e5f63eeb374a3cf))

# [1.2.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.1.0...@napi-rs/cli@1.2.0) (2021-08-06)

### Features

- **cli:** upgrade clipanion v3 ([67ad0a4](https://github.com/napi-rs/napi-rs/commit/67ad0a4d4daa0e0d14dc488bec190dcb27022634))

# [1.1.0](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.0.4...@napi-rs/cli@1.1.0) (2021-06-07)

### Features

- **cli:** support skip gh-release in prepublish command ([253360e](https://github.com/napi-rs/napi-rs/commit/253360efb9a4675be88393d6a335ec75fbb326c8))
- **cli:** update new project template ([9aac626](https://github.com/napi-rs/napi-rs/commit/9aac6267b72b3ef1a317d7e3a5a84827c6c37850))

## [1.0.3](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.0.2...@napi-rs/cli@1.0.3) (2021-02-06)

### Bug Fixes

- **cli:** new command without npm scope ([5ef1887](https://github.com/napi-rs/napi-rs/commit/5ef1887ea96d529bf6bd4e52d6d77ffbd6baf13e))

## [1.0.2](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.0.1...@napi-rs/cli@1.0.2) (2021-01-15)

### Bug Fixes

- **cli:** mkdir -p is not valid command in powershell ([84a6ea9](https://github.com/napi-rs/napi-rs/commit/84a6ea9223e4eabbf1feac6cf7a71211f3404ce7))

## [1.0.1](https://github.com/napi-rs/napi-rs/compare/@napi-rs/cli@1.0.0-alpha.14...@napi-rs/cli@1.0.1) (2021-01-07)

### Bug Fixes

- **cli:** fix random node process got killed issue ([58d4634](https://github.com/napi-rs/napi-rs/commit/58d4634dacca673a83bf49cfb2dd15c7f8444865))

# 1.0.0 (2020-12-29)
