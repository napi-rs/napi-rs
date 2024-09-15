import type { SupportedPackageManager } from '../../utils/config.js'

export type WasiTargetName =
  | 'wasm32-wasi-preview1-threads'
  | 'wasm32-wasip1-threads'
  | 'wasm32-wasip2'

export const YAML = (
  packageManager: SupportedPackageManager,
  wasiTargetName: WasiTargetName,
) => `
name: CI

env:
  DEBUG: 'napi:*'
  MACOSX_DEPLOYMENT_TARGET: '10.13'

permissions:
  contents: write
  id-token: write

on:
  push:
    branches:
      - main
    tags-ignore:
      - '**'
    paths-ignore:
      - '**/*.md'
      - 'LICENSE'
      - '**/*.gitignore'
      - '.editorconfig'
      - 'docs/**'
  pull_request:

jobs:
  build:

    strategy:
      fail-fast: false
      matrix:
        settings:
          - host: macos-latest
            target: 'x86_64-apple-darwin'
            build: ${packageManager} build --platform --target x86_64-apple-darwin
          - host: windows-latest
            build: ${packageManager} build --platform
            target: 'x86_64-pc-windows-msvc'
          - host: windows-latest
            build: |
              ${packageManager} build --platform --target i686-pc-windows-msvc
              ${packageManager} test
            target: 'i686-pc-windows-msvc'
          - host: ubuntu-latest
            target: 'x86_64-unknown-linux-gnu'
            build: ${packageManager} build --platform --target x86_64-unknown-linux-gnu --use-napi-cross
          - host: ubuntu-latest
            target: 'x86_64-unknown-linux-musl'
            build: ${packageManager} build --platform --target x86_64-unknown-linux-musl -x
          - host: macos-latest
            target: 'aarch64-apple-darwin'
            build: ${packageManager} build --platform --target aarch64-apple-darwin
          - host: ubuntu-latest
            target: 'aarch64-unknown-linux-gnu'
            build: ${packageManager} build --platform --target aarch64-unknown-linux-gnu --use-napi-cross
          - host: ubuntu-latest
            target: 'armv7-unknown-linux-gnueabihf'
            build: ${packageManager} build --platform --target armv7-unknown-linux-gnueabihf --use-napi-cross
          - host: ubuntu-latest
            target: 'armv7-unknown-linux-musleabihf'
            build: ${packageManager} build --platform --target armv7-unknown-linux-musleabihf -x
          - host: ubuntu-latest
            target: 'aarch64-linux-android'
            build: ${packageManager} build --platform --target aarch64-linux-android
          - host: ubuntu-latest
            target: 'armv7-linux-androideabi'
            build: ${packageManager} build --platform --target armv7-linux-androideabi
          - host: ubuntu-latest
            target: 'aarch64-unknown-linux-musl'
            build: ${packageManager} build --platform --target aarch64-unknown-linux-musl -x
          - host: windows-latest
            target: 'aarch64-pc-windows-msvc'
            build: ${packageManager} build --platform --target aarch64-pc-windows-msvc
          - host: ubuntu-latest
            target: 'riscv64gc-unknown-linux-gnu'
            setup: |
              sudo apt-get update
              sudo apt-get install gcc-riscv64-linux-gnu -y
            build: ${packageManager} build --platform --target riscv64gc-unknown-linux-gnu
          - host: ubuntu-latest
            target: 'powerpc64le-unknown-linux-gnu'
            setup: |
              sudo apt-get update
              sudo apt-get install gcc-powerpc64le-linux-gnu -y
            build: ${packageManager} build --platform --target powerpc64le-unknown-linux-gnu
          - host: ubuntu-latest
            target: 's390x-unknown-linux-gnu'
            setup: |
              sudo apt-get update
              sudo apt-get install gcc-s390x-linux-gnu -y
            build: ${packageManager} build --platform --target s390x-unknown-linux-gnu
          - host: ubuntu-latest
            target: '${wasiTargetName}'
            build: ${packageManager} build --platform --target ${wasiTargetName}

    name: stable - \${{ matrix.settings.target }} - node@20
    runs-on: \${{ matrix.settings.host }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: ${packageManager}

      - name: Install
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: stable
          targets: \${{ matrix.settings.target }}

      - name: Cache cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
            ~/.cargo/git/db/
            ~/.napi-rs
            .cargo-cache
            target/
          key: \${{ matrix.settings.target }}-cargo-\${{ matrix.settings.host }}

      - uses: goto-bus-stop/setup-zig@v2
        if: \${{ contains(matrix.settings.target, 'musl') }}
        with:
          version: 0.13.0

      - name: Install cargo-zigbuild
        uses: taiki-e/install-action@v2
        if: \${{ contains(matrix.settings.target, 'musl') }}
        env:
          GITHUB_TOKEN: \${{ github.token }}
        with:
          tool: cargo-zigbuild

      - name: Setup toolchain
        run: \${{ matrix.settings.setup }}
        if: \${{ matrix.settings.setup }}
        shell: bash

      - name: Setup node x86
        if: matrix.settings.target == 'i686-pc-windows-msvc'
        run: yarn config set supportedArchitectures.cpu "ia32"
        shell: bash

      - name: 'Install dependencies'
        run: ${packageManager} install

      - name: Setup node x86
        uses: actions/setup-node@v4
        if: matrix.settings.target == 'i686-pc-windows-msvc'
        with:
          node-version: 20
          architecture: x86

      - name: 'Build'
        run: \${{ matrix.settings.build }}
        shell: bash

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        if: matrix.settings.target != '${wasiTargetName}'
        with:
          name: bindings-\${{ matrix.settings.target }}
          path: "*.node"
          if-no-files-found: error

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        if: matrix.settings.target == '${wasiTargetName}'
        with:
          name: bindings-\${{ matrix.settings.target }}
          path: "*.wasm"
          if-no-files-found: error

  build-freebsd:
    runs-on: ubuntu-latest
    name: Build FreeBSD
    steps:
      - uses: actions/checkout@v4
      - name: Build
        id: build
        uses: cross-platform-actions/action@v0.25.0
        env:
          DEBUG: 'napi:*'
          RUSTUP_IO_THREADS: 1
        with:
          operating_system: freebsd
          version: '14.1'
          memory: 8G
          cpu_count: 3
          environment_variables: 'DEBUG RUSTUP_IO_THREADS'
          shell: bash
          run: |
            sudo pkg install -y -f curl node libnghttp2 npm
            sudo npm install -g ${packageManager} --ignore-scripts
            curl https://sh.rustup.rs -sSf --output rustup.sh
            sh rustup.sh -y --profile minimal --default-toolchain stable
            source "$HOME/.cargo/env"
            echo "~~~~ rustc --version ~~~~"
            rustc --version
            echo "~~~~ node -v ~~~~"
            node -v
            echo "~~~~ yarn --version ~~~~"
            yarn --version
            pwd
            ls -lah
            whoami
            env
            freebsd-version
            ${packageManager} install
            ${packageManager} build
            strip -x *.node
            yarn test
            rm -rf node_modules
            rm -rf target
            rm -rf .yarn/cache
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: bindings-freebsd
          path: "*.node"
          if-no-files-found: error

  test-macOS-windows-binding:
    name: Test bindings on \${{ matrix.settings.target }} - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        settings:
          - host: macos-latest
            target: 'x86_64-apple-darwin'
            architecture: x64
          - host: macos-latest
            target: 'aarch64-apple-darwin'
            architecture: arm64
          - host: windows-latest
            target: 'x86_64-pc-windows-msvc'
            architecture: x64
        node: ['18', '20']
    runs-on: \${{ matrix.settings.host }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup node
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: '${packageManager}'
          architecture: \${{ matrix.settings.architecture }}

      - name: 'Install dependencies'
        run: ${packageManager} install

      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: bindings-\${{ matrix.settings.target }}
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Test bindings
        run: ${packageManager} run test

  test-linux-x64-gnu-binding:
    name: Test bindings on Linux-x64-gnu - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['18', '20']
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup node
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: '${packageManager}'

      - name: 'Install dependencies'
        run: ${packageManager} install

      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: bindings-x86_64-unknown-linux-gnu
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Test bindings
        run: docker run --rm -v $(pwd):/build -w /build node:\${{ matrix.node }}-slim ${packageManager} run test

  test-linux-x64-musl-binding:
    name: Test bindings on x86_64-unknown-linux-musl - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['18', '20']
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup node
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: '${packageManager}'

      - name: 'Install dependencies'
        run: |
          yarn config set supportedArchitectures.libc "musl"
          ${packageManager} install

      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: bindings-x86_64-unknown-linux-musl
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Test bindings
        run: docker run --rm -v $(pwd):/build -w /build node:\${{ matrix.node }}-alpine ${packageManager} run test

  test-linux-aarch64-gnu-binding:
    name: Test bindings on aarch64-unknown-linux-gnu - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['20']
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: bindings-aarch64-unknown-linux-gnu
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Install dependencies
        run: |
          yarn config set supportedArchitectures.cpu "arm64"
          yarn config set supportedArchitectures.libc "glibc"
          ${packageManager} install

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
        with:
          platforms: arm64
      - run: docker run --rm --privileged multiarch/qemu-user-static --reset -p yes

      - name: Setup and run tests
        uses: addnab/docker-run-action@v3
        with:
          image: node:\${{ matrix.node }}-slim
          options: --platform linux/arm64 -v \${{ github.workspace }}:/build -w /build
          run: ${packageManager} run test

  test-linux-aarch64-musl-binding:
    name: Test bindings on aarch64-unknown-linux-musl - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['18', '20']

    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: bindings-aarch64-unknown-linux-musl
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Install dependencies
        run: |
          yarn config set supportedArchitectures.cpu "arm64"
          yarn config set supportedArchitectures.libc "musl"
          ${packageManager} install

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
        with:
          platforms: arm64
      - run: docker run --rm --privileged multiarch/qemu-user-static --reset -p yes

      - name: Setup and run tests
        uses: addnab/docker-run-action@v3
        with:
          image: node:\${{ matrix.node }}-alpine
          options: --platform linux/arm64 -v \${{ github.workspace }}:/build -w /build
          run: ${packageManager} run test

  test-linux-arm-gnueabihf-binding:
    name: Test bindings on armv7-unknown-linux-gnueabihf - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['18', '20']
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: bindings-armv7-unknown-linux-gnueabihf
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Install dependencies
        run: |
          yarn config set supportedArchitectures.cpu "arm"
          ${packageManager} install

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
        with:
          platforms: arm
      - run: docker run --rm --privileged multiarch/qemu-user-static --reset -p yes

      - name: Setup and run tests
        uses: addnab/docker-run-action@v3
        with:
          image: node:\${{ matrix.node }}-bullseye-slim
          options: --platform linux/arm/v7 -v \${{ github.workspace }}:/build -w /build
          run: ${packageManager} test

  universal-macOS:
    name: Build universal macOS binary
    needs:
      - build
    runs-on: macos-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: ${packageManager}

      - name: 'Install dependencies'
        run: ${packageManager} install

      - name: Download macOS x64 artifact
        uses: actions/download-artifact@v4
        with:
          name: bindings-x86_64-apple-darwin
          path: .
      - name: Download macOS arm64 artifact
        uses: actions/download-artifact@v4
        with:
          name: bindings-aarch64-apple-darwin
          path: .

      - name: Combine binaries
        run: ${packageManager} napi universalize

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: bindings-universal-apple-darwin
          path: "*.node"
          if-no-files-found: error

  test-wasi-nodejs:
    name: Test bindings on wasi - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['18', '20']
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: bindings-${wasiTargetName}
          path: .
      - name: List packages
        run: ls -R .
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: ${packageManager}
      - name: 'Install dependencies'
        run: ${packageManager} install
      - name: Test
        run: ${packageManager} test
        env:
          NAPI_RS_FORCE_WASI: true

  publish:
    name: Publish
    runs-on: ubuntu-latest
    needs:
      - test-linux-x64-gnu-binding
      - test-linux-x64-musl-binding
      - test-linux-aarch64-gnu-binding
      - test-linux-arm-gnueabihf-binding
      - test-macOS-windows-binding
      - test-linux-aarch64-musl-binding
      - test-wasi-nodejs
      - build-freebsd

    steps:
      - uses: actions/checkout@v4

      - name: Setup node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: '${packageManager}'
          registry-url: 'https://registry.npmjs.org'

      - name: 'Install dependencies'
        run: ${packageManager} install

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Move artifacts
        run: ${packageManager} artifacts

      - name: List packages
        run: ls -R ./npm
        shell: bash

      - name: Publish
        run: |
          if git log -1 --pretty=%B | grep "^[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+$";
          then
            npm publish --access public --provenance
          elif git log -1 --pretty=%B | grep "^[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+";
          then
            npm publish --tag next --access public --provenance
          else
            echo "Not a release, skipping publish"
          fi
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`
