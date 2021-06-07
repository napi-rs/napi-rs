const OLDEST_LTS_NODE = 10
const LATEST_LTS_NODE = 14
const SUPPORTED_NODE_VERSIONS = [10, 12, 14, 15]

const OS_LINUX = 'ubuntu-18.04'
const OS_OSX = 'macos-latest'
const OS_WINDOWS = 'windows-latest'

const STEP_BUILD = 'build'
const STEP_BUILD_LINUX_MUSL = 'build-linux-musl'
const STEP_BUILD_LINUX_ARM7 = 'build-linux-arm7'
const STEP_BUILD_LINUX_ARM8 = 'build-linux-aarch64'
const STEP_BUILD_APPLE_SILICON = 'build-apple-silicon'
const STEP_BUILD_ANDROID = 'build-android-aarch64'
const STEP_TEST = 'test'
const STEP_TEST_LINUX_MUSL = 'test-linux-musl'
const STEP_TEST_LINUX_ARM8 = 'test-linux-aarch64'

export const createGithubActionsCIYml = (
  binaryName: string,
  targets: string[],
) => {
  const enableWindowsX86 = targets.includes('x86_64-pc-windows-msvc')
  const enableMacOSX86 = targets.includes('x86_64-apple-darwin')
  const enableLinuxX86 = targets.includes('x86_64-unknown-linux-gnu')
  const enableLinuxMuslX86 = targets.includes('x86_64-unknown-linux-musl')
  const enableLinuxArm7 = targets.includes('armv7-unknown-linux-gnueabihf')
  const enableLinuxArm8 = targets.includes('aarch64-unknown-linux-gnu')
  const enableAppleSilicon = targets.includes('aarch64-apple-darwin')
  const enableAndroid = targets.includes('aarch64-linux-android')
  const os: string[] = []
  const requiredSteps: string[] = []
  if (enableLinuxX86) {
    os.push(OS_LINUX)
  }
  if (enableMacOSX86) {
    os.push(OS_OSX)
  }
  if (enableWindowsX86) {
    os.push(OS_WINDOWS)
  }

  if (os.length) {
    requiredSteps.push(STEP_TEST)
  }
  if (enableLinuxMuslX86) {
    requiredSteps.push(STEP_TEST_LINUX_MUSL)
  }
  if (enableLinuxArm7) {
    requiredSteps.push(STEP_BUILD_LINUX_ARM7)
  }
  if (enableLinuxArm8) {
    requiredSteps.push(STEP_TEST_LINUX_ARM8)
  }
  if (enableAppleSilicon) {
    requiredSteps.push(STEP_BUILD_APPLE_SILICON)
  }
  if (enableAndroid) {
    requiredSteps.push(STEP_BUILD_ANDROID)
  }

  const BUILD_SCRIPT = !os.length
    ? ''
    : `${STEP_BUILD}:
    if: "!contains(github.event.head_commit.message, 'skip ci')"

    strategy:
      fail-fast: false
      matrix:
        os: [${os.join(', ')}]

    name: stable - \${{ matrix.os }} - node@${LATEST_LTS_NODE}
    runs-on: \${{ matrix.os }}

    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: ${LATEST_LTS_NODE}
          check-latest: true

      - name: Install
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          profile: minimal
          override: true

      - name: Generate Cargo.lock
        uses: actions-rs/cargo@v1
        with:
          command: generate-lockfile

      - name: Cache cargo registry
        uses: actions/cache@v1
        with:
          path: ~/.cargo/registry
          key: stable-\${{ matrix.os }}-node@${LATEST_LTS_NODE}-cargo-registry-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache cargo index
        uses: actions/cache@v1
        with:
          path: ~/.cargo/git
          key: stable-\${{ matrix.os }}-node@${LATEST_LTS_NODE}-cargo-index-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-\${{ matrix.os }}-node@${LATEST_LTS_NODE}-\${{ hashFiles('yarn.lock') }}

      - name: 'Install dependencies'
        run: yarn install --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: 'Build'
        run: yarn build
        env:
          MACOSX_DEPLOYMENT_TARGET: '10.13'

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: bindings-\${{ matrix.os }}
          path: \${{ env.APP_NAME }}.*.node

      - name: Clear the cargo caches
        run: |
          cargo install cargo-cache --no-default-features --features ci-autoclean
          cargo-cache`

  const BUILD_MUSL_SCRIPT = !enableLinuxMuslX86
    ? ''
    : `${STEP_BUILD_LINUX_MUSL}:
    if: "!contains(github.event.head_commit.message, 'skip ci')"
    name: stable - linux-musl - node@${OLDEST_LTS_NODE}
    runs-on: ${OS_LINUX}

    steps:
      - uses: actions/checkout@v2

      - name: Login to registry
        run: |
          docker login -u $DOCKER_USERNAME -p $DOCKER_PASSWORD $DOCKER_REGISTRY_URL
        env:
          DOCKER_REGISTRY_URL: docker.pkg.github.com
          DOCKER_USERNAME: \${{ github.actor }}
          DOCKER_PASSWORD: \${{ secrets.GITHUB_TOKEN }}

      - name: Pull docker image
        run: |
          docker pull docker.pkg.github.com/napi-rs/napi-rs/rust-nodejs-alpine:lts
          docker tag docker.pkg.github.com/napi-rs/napi-rs/rust-nodejs-alpine:lts builder

      - name: Generate Cargo.lock
        uses: actions-rs/cargo@v1
        with:
          command: generate-lockfile

      - name: Cache cargo registry
        uses: actions/cache@v1
        with:
          path: ~/.cargo/registry
          key: stable-node-alpine-@${OLDEST_LTS_NODE}-cargo-registry-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache cargo index
        uses: actions/cache@v1
        with:
          path: ~/.cargo/git
          key: stable-node-alpine-@${OLDEST_LTS_NODE}-cargo-index-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-alpine-node@${OLDEST_LTS_NODE}-\${{ hashFiles('yarn.lock') }}

      - name: 'Install dependencies'
        run: yarn install --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: 'Build'
        run: |
          docker run --rm -v ~/.cargo/git:/root/.cargo/git -v ~/.cargo/registry:/root/.cargo/registry -v $(pwd):/\${{ env.APP_NAME }} -e DEBUG="napi:*" -w /\${{ env.APP_NAME }} builder sh -c "yarn build"

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: bindings-linux-musl
          path: \${{ env.APP_NAME }}.*.node`

  const BUILD_LINUX_ARM7_SCRIPT = !enableLinuxArm7
    ? ''
    : `${STEP_BUILD_LINUX_ARM7}:
    name: stable - arm7-unknown-linux-gnu - node@${LATEST_LTS_NODE}
    runs-on: ${OS_LINUX}

    steps:
      - run: docker run --rm --privileged multiarch/qemu-user-static:register --reset

      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v1
        with:
          node-version: ${LATEST_LTS_NODE}

      - name: Install
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          profile: minimal
          override: true

      - name: Generate Cargo.lock
        uses: actions-rs/cargo@v1
        with:
          command: generate-lockfile

      - name: Cache cargo registry
        uses: actions/cache@v1
        with:
          path: ~/.cargo/registry
          key: stable-linux-arm7-gnu-node@${LATEST_LTS_NODE}-cargo-registry-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache cargo index
        uses: actions/cache@v1
        with:
          path: ~/.cargo/git
          key: stable-linux-arm7-gnu-node@${LATEST_LTS_NODE}-cargo-index-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-linux-arm7-gnu-node@${LATEST_LTS_NODE}-\${{ hashFiles('yarn.lock') }}

      - name: Install arm7 toolchain
        run: rustup target add armv7-unknown-linux-gnueabihf

      - name: Install cross compile toolchain
        run: |
          sudo apt-get update
          sudo apt-get install gcc-arm-linux-gnueabihf -y

      - name: Install dependencies
        run: yarn install --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Cross build arm7
        run: yarn build --target armv7-unknown-linux-gnueabihf

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: bindings-linux-arm7
          path: \${{ env.APP_NAME }}.*.node`

  const BUILD_LINUX_ARM8_SCRIPT = !enableLinuxArm8
    ? ''
    : `${STEP_BUILD_LINUX_ARM8}:
    name: stable - aarch64-unknown-linux-gnu - node@${LATEST_LTS_NODE}
    runs-on: ${OS_LINUX}

    steps:
      - run: docker run --rm --privileged multiarch/qemu-user-static:register --reset

      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: ${LATEST_LTS_NODE}
          check-latest: true

      - name: Install
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          profile: minimal
          override: true

      - name: Install aarch64 toolchain
        run: rustup target add aarch64-unknown-linux-gnu

      - name: Generate Cargo.lock
        uses: actions-rs/cargo@v1
        with:
          command: generate-lockfile

      - name: Cache cargo registry
        uses: actions/cache@v1
        with:
          path: ~/.cargo/registry
          key: stable-linux-aarch64-gnu-node@${LATEST_LTS_NODE}-cargo-registry-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache cargo index
        uses: actions/cache@v1
        with:
          path: ~/.cargo/git
          key: stable-linux-aarch64-gnu-node@${LATEST_LTS_NODE}-cargo-index-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-linux-aarch64-gnu-node@${LATEST_LTS_NODE}-\${{ hashFiles('yarn.lock') }}

      - name: Install cross compile toolchain
        run: |
          sudo apt-get update
          sudo apt-get install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu -y

      - name: Install dependencies
        run: yarn install --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Cross build aarch64
        run: yarn build --target aarch64-unknown-linux-gnu

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: bindings-linux-aarch64
          path: \${{ env.APP_NAME }}.*.node`

  const BUILD_APPLE_SILICON_SCRIPT = !enableAppleSilicon
    ? ''
    : `${STEP_BUILD_APPLE_SILICON}:
    name: nightly - aarch64-apple-darwin - node@${LATEST_LTS_NODE}
    runs-on: macos-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: ${LATEST_LTS_NODE}
          check-latest: true

      - name: Install
        uses: actions-rs/toolchain@v1
        with:
          toolchain: nightly
          profile: minimal
          override: true

      - name: Install aarch64 toolchain
        run: rustup target add aarch64-apple-darwin

      - name: Generate Cargo.lock
        uses: actions-rs/cargo@v1
        with:
          command: generate-lockfile

      - name: Cache cargo registry
        uses: actions/cache@v1
        with:
          path: ~/.cargo/registry
          key: nightly-apple-aarch64-node@${LATEST_LTS_NODE}-cargo-registry-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache cargo index
        uses: actions/cache@v1
        with:
          path: ~/.cargo/git
          key: nightly-apple-aarch64-node@${LATEST_LTS_NODE}-cargo-index-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-apple-aarch64-node@${LATEST_LTS_NODE}-\${{ hashFiles('yarn.lock') }}

      - name: Install dependencies
        run: yarn install --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Cross build aarch64
        run: yarn build --target aarch64-apple-darwin

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: bindings-apple-aarch64
          path: \${{ env.APP_NAME }}.*.node`

  const BUILD_ANDROID_SCRIPT = !enableAndroid
    ? ''
    : `${STEP_BUILD_ANDROID}:
    name: Build - Android - aarch64
    runs-on: ${OS_OSX}
    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v1
        with:
          node-version: ${LATEST_LTS_NODE}

      - name: Install aarch64 toolchain
        run: rustup target add aarch64-linux-android

      - name: Generate Cargo.lock
        uses: actions-rs/cargo@v1
        with:
          command: generate-lockfile

      - name: Cache cargo registry
        uses: actions/cache@v1
        with:
          path: ~/.cargo/registry
          key: nightly-apple-aarch64-node@${LATEST_LTS_NODE}-cargo-registry-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache cargo index
        uses: actions/cache@v1
        with:
          path: ~/.cargo/git
          key: nightly-apple-aarch64-node@${LATEST_LTS_NODE}-cargo-index-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-apple-aarch64-node@${LATEST_LTS_NODE}-\${{ hashFiles('yarn.lock') }}

      - name: Install dependencies
        run: yarn install --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Build
        shell: bash
        run: |
          export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="\${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android24-clang"
          yarn build --target aarch64-linux-android

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: bindings-android-aarch64
          path: \${{ env.APP_NAME }}.*.node`

  const TEST_SCRIPT = !os.length
    ? ''
    : `${STEP_TEST}:
    name: Test bindings on \${{ matrix.os }} - node@\${{ matrix.node }}
    needs:
      - ${STEP_BUILD}
    strategy:
      fail-fast: false
      matrix:
        os: [${os.join(', ')}]
        node: [${SUPPORTED_NODE_VERSIONS.join(', ')}]
    runs-on: \${{ matrix.os }}

    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: \${{ matrix.node }}
          check-latest: true

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-test-\${{ matrix.os }}-node@\${{ matrix.node }}-\${{ hashFiles('yarn.lock') }}

      - name: 'Install dependencies'
        run: yarn install --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-\${{ matrix.os }}
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Test bindings
        run: yarn test`

  const TEST_MUSL_SCRIPT = !enableLinuxMuslX86
    ? ''
    : `${STEP_TEST_LINUX_MUSL}:
    name: Test bindings on alpine - node@\${{ matrix.node }}
    needs:
      - ${STEP_BUILD_LINUX_MUSL}
    strategy:
      fail-fast: false
      matrix:
        node: [${SUPPORTED_NODE_VERSIONS.join(', ')}]
    runs-on: ${OS_LINUX}

    steps:
      - uses: actions/checkout@v2

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-alpine-node@\${{ matrix.node }}-\${{ hashFiles('yarn.lock') }}

      - name: 'Install dependencies'
        run: yarn install --frozen-lockfile --ignore-scripts --registry https://registry.npmjs.org

      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-linux-musl
          path: .

      - name: List files
        run: ls -R .
        shell: bash

      - name: Run tests
        run: docker run --rm -v $(pwd):/\${{ env.APP_NAME }} -w /\${{ env.APP_NAME }} node:\${{ matrix.node }}-alpine sh -c "yarn test"         `

  const TEST_LINUX_ARM8_SCRIPT = !enableLinuxArm8
    ? ''
    : `${STEP_TEST_LINUX_ARM8}:
    name: stable - aarch64-unknown-linux-gnu - node@\${{ matrix.node }}
    runs-on: ${OS_LINUX}

    needs:
      - ${STEP_BUILD_LINUX_ARM8}
    strategy:
      fail-fast: false
      matrix:
        node: [${SUPPORTED_NODE_VERSIONS.join(', ')}]

    steps:
      - run: docker run --rm --privileged multiarch/qemu-user-static:register --reset

      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: \${{ matrix.node }}
          check-latest: true

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-test-linux-aarch64-gnu-node@\${{ matrix.node }}-\${{ hashFiles('yarn.lock') }}

      - name: 'Install dependencies'
        run: yarn install --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-linux-aarch64
          path: .

      - name: List
        run: ls -a

      - name: Run tests
        uses: docker://multiarch/ubuntu-core:arm64-focal
        with:
          args: >
            sh -c "
              apt-get update && \\
              apt-get install -y ca-certificates gnupg2 curl && \\
              curl -sL https://deb.nodesource.com/setup_\${{ matrix.node }}.x | bash - && \\
              apt-get install -y nodejs && \\
              node ./simple-test.js
            "`

  return `name: CI

env:
  DEBUG: 'napi:*'
  APP_NAME: '${binaryName}'

on:
  push:
    branches:
      - main
    tags-ignore:
      - '**'
  pull_request:

jobs:
${[
  BUILD_SCRIPT,
  BUILD_MUSL_SCRIPT,
  BUILD_LINUX_ARM7_SCRIPT,
  BUILD_LINUX_ARM8_SCRIPT,
  BUILD_APPLE_SILICON_SCRIPT,
  BUILD_ANDROID_SCRIPT,
  TEST_SCRIPT,
  TEST_MUSL_SCRIPT,
  TEST_LINUX_ARM8_SCRIPT,
]
  .filter((s) => s.length)
  .map((script) => `  ${script}`)
  .join('\n\n')}

  dependabot:
    needs:
${requiredSteps.map((s) => `      - ${s}`).join('\n')}
    runs-on: ${OS_LINUX}
    steps:
      - name: auto-merge
        uses: ridedott/dependabot-auto-merge-action@master
        with:
          GITHUB_LOGIN: dependabot[bot]
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}

  publish:
    name: Publish
    runs-on: ${OS_LINUX}
    needs:
${requiredSteps.map((s) => `      - ${s}`).join('\n')}
    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: ${LATEST_LTS_NODE}
          check-latest: true

      - name: Cache NPM dependencies
        uses: actions/cache@v1
        with:
          path: node_modules
          key: npm-cache-publish-ubuntu-latest-\${{ hashFiles('yarn.lock') }}

      - name: 'Install dependencies'
        run: yarn install --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Download all artifacts
        uses: actions/download-artifact@v2
        with:
          path: artifacts

      - name: Move artifacts
        run: yarn artifacts

      - name: List packages
        run: ls -R npm
        shell: bash

      - name: Publish
        run: |
          ${'if git log -1 --pretty=%B | grep "^[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+$";'}
          then
            echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" >> ~/.npmrc
            npm publish --access public
          ${'elif git log -1 --pretty=%B | grep "^[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+";'}
          then
            echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" >> ~/.npmrc
            npm publish --tag next --access public
          else
            echo "Not a release, skipping publish"
          fi
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}

  `
}
