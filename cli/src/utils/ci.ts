import { TargetTriple } from './target.js'

export const CIConfig: Partial<
  Record<
    TargetTriple,
    {
      host: string
      build_image?: string
      build_setup?: string[]
      test?: boolean
      test_image?: string
      test_setup?: string[]
      yarn_cpu?: string
      yarn_libc?: string
    }
  >
> = {
  'x86_64-apple-darwin': {
    host: 'macos-latest',
  },
  'x86_64-pc-windows-msvc': {
    host: 'windows-latest',
  },
  'i686-pc-windows-msvc': {
    host: 'windows-latest',
    test: false,
  },
  'x86_64-unknown-linux-gnu': {
    host: 'ubuntu-latest',
    build_image: 'ghcr.io/napi-rs/napi-rs/nodejs-rust:lts-debian',
  },
  'x86_64-unknown-linux-musl': {
    host: 'ubuntu-latest',
    build_image: 'ghcr.io/napi-rs/napi-rs/nodejs-rust:lts-alpine',
    test_image: 'node:${{ matrix.node }}-alpine',
    yarn_libc: 'musl',
  },
  'aarch64-apple-darwin': {
    host: 'macos-latest',
    build_setup: [
      'sudo rm -Rf /Library/Developer/CommandLineTools/SDKs/*',
      'export CC=$(xcrun -f clang)',
      'export CXX=$(xcrun -f clang++)',
      'export SDK_ROOT=$(xcrun --sdk macosx --show-sdk-path)',
      'export CFLAGS="-isysroot $SDK_ROOT -isystem $SDK_ROOT"',
    ],
    test: false,
  },
  'aarch64-unknown-linux-gnu': {
    host: 'ubuntu-latest',
    build_image: 'ghcr.io/napi-rs/napi-rs/nodejs-rust:lts-debian-aarch64',
    build_setup: [
      'sudo apt-get update',
      'sudo apt-get install g++-aarch64-linux-gnu gcc-aarch64-linux-gnu -y',
      'export CARGO_BUILD_TARGET=x86_64-unknown-linux-gnu',
    ],
    test_image: 'ghcr.io/napi-rs/napi-rs/nodejs:aarch64-${{ matrix.node }}',
    yarn_cpu: 'arm64',
  },
  'aarch64-unknown-linux-musl': {
    host: 'ubuntu-latest',
    build_image: 'ghcr.io/napi-rs/napi-rs/nodejs-rust:lts-alpine',
    build_setup: ['rustup target add aarch64-unknown-linux-musl'],
    test_image: 'multiarch/alpine:aarch64-latest-stable',
    test_setup: ['apk add nodejs npm yarn'],
    yarn_cpu: 'arm64',
    yarn_libc: 'musl',
  },
  'aarch64-pc-windows-msvc': {
    host: 'windows-latest',
    test: false,
  },
  'armv7-unknown-linux-gnueabihf': {
    host: 'ubuntu-latest',
    build_setup: [
      'sudo apt-get update',
      'sudo apt-get install gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf -y',
    ],
    yarn_cpu: 'arm',
    test_image: 'ghcr.io/napi-rs/napi-rs/nodejs:armhf-${{ matrix.node }}',
  },
  'aarch64-linux-android': {
    host: 'ubuntu-latest',
    build_setup: [
      'export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"',
      'export CC="${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"',
      'export CXX="${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang++"',
      'export PATH="${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin:${PATH}"',
    ],
    test: false,
  },
  'armv7-linux-androideabi': {
    host: 'ubuntu-latest',
    build_setup: [
      'export CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER="${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/armv7a-linux-androideabi24-clang"',
      'export CC="${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/armv7a-linux-androideabi24-clang"',
      'export CXX="${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/armv7a-linux-androideabi24-clang++"',
      'export PATH="${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin:${PATH}"',
    ],
    test: false,
  },
}
