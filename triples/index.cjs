module.exports.platformArchTriples = {
  darwin: {
    arm64: [
      {
        triple: 'aarch64-apple-darwin',
        platformArchABI: 'darwin-arm64',
        platform: 'darwin',
        arch: 'arm64',
        abi: null,
      },
    ],
    x64: [
      {
        triple: 'x86_64-apple-darwin',
        platformArchABI: 'darwin-x64',
        platform: 'darwin',
        arch: 'x64',
        abi: null,
      },
    ],
  },
  ios: {
    arm64: [
      {
        triple: 'aarch64-apple-ios',
        platformArchABI: 'ios-arm64',
        platform: 'ios',
        arch: 'arm64',
        abi: null,
      },
      {
        triple: 'aarch64-apple-ios-macabi',
        platformArchABI: 'ios-arm64-macabi',
        platform: 'ios',
        arch: 'arm64',
        abi: 'macabi',
      },
      {
        triple: 'aarch64-apple-ios-sim',
        platformArchABI: 'ios-arm64-sim',
        platform: 'ios',
        arch: 'arm64',
        abi: 'sim',
      },
    ],
    x64: [
      {
        triple: 'x86_64-apple-ios',
        platformArchABI: 'ios-x64',
        platform: 'ios',
        arch: 'x64',
        abi: null,
      },
      {
        triple: 'x86_64-apple-ios-macabi',
        platformArchABI: 'ios-x64-macabi',
        platform: 'ios',
        arch: 'x64',
        abi: 'macabi',
      },
    ],
  },
  android: {
    arm64: [
      {
        triple: 'aarch64-linux-android',
        platformArchABI: 'android-arm64',
        platform: 'android',
        arch: 'arm64',
        abi: null,
      },
    ],
    arm: [
      {
        triple: 'arm-linux-androideabi',
        platformArchABI: 'android-arm-eabi',
        platform: 'android',
        arch: 'arm',
        abi: 'eabi',
      },
      {
        triple: 'armv7-linux-androideabi',
        platformArchABI: 'android-arm-eabi',
        platform: 'android',
        arch: 'arm',
        abi: 'eabi',
      },
    ],
    ia32: [
      {
        triple: 'i686-linux-android',
        platformArchABI: 'android-ia32',
        platform: 'android',
        arch: 'ia32',
        abi: null,
      },
    ],
    thumbv7neon: [
      {
        triple: 'thumbv7neon-linux-androideabi',
        platformArchABI: 'android-thumbv7neon-eabi',
        platform: 'android',
        arch: 'thumbv7neon',
        abi: 'eabi',
      },
    ],
    x64: [
      {
        triple: 'x86_64-linux-android',
        platformArchABI: 'android-x64',
        platform: 'android',
        arch: 'x64',
        abi: null,
      },
    ],
  },
  win32: {
    arm64: [
      {
        triple: 'aarch64-pc-windows-gnullvm',
        platformArchABI: 'win32-arm64-gnullvm',
        platform: 'win32',
        arch: 'arm64',
        abi: 'gnullvm',
      },
      {
        triple: 'aarch64-pc-windows-msvc',
        platformArchABI: 'win32-arm64-msvc',
        platform: 'win32',
        arch: 'arm64',
        abi: 'msvc',
      },
    ],
    arm64ec: [
      {
        triple: 'arm64ec-pc-windows-msvc',
        platformArchABI: 'win32-arm64ec-msvc',
        platform: 'win32',
        arch: 'arm64ec',
        abi: 'msvc',
      },
    ],
    ia32: [
      {
        triple: 'i686-pc-windows-gnu',
        platformArchABI: 'win32-ia32-gnu',
        platform: 'win32',
        arch: 'ia32',
        abi: 'gnu',
      },
      {
        triple: 'i686-pc-windows-gnullvm',
        platformArchABI: 'win32-ia32-gnullvm',
        platform: 'win32',
        arch: 'ia32',
        abi: 'gnullvm',
      },
      {
        triple: 'i686-pc-windows-msvc',
        platformArchABI: 'win32-ia32-msvc',
        platform: 'win32',
        arch: 'ia32',
        abi: 'msvc',
      },
    ],
    x64: [
      {
        triple: 'x86_64-pc-windows-gnu',
        platformArchABI: 'win32-x64-gnu',
        platform: 'win32',
        arch: 'x64',
        abi: 'gnu',
      },
      {
        triple: 'x86_64-pc-windows-gnullvm',
        platformArchABI: 'win32-x64-gnullvm',
        platform: 'win32',
        arch: 'x64',
        abi: 'gnullvm',
      },
      {
        triple: 'x86_64-pc-windows-msvc',
        platformArchABI: 'win32-x64-msvc',
        platform: 'win32',
        arch: 'x64',
        abi: 'msvc',
      },
    ],
  },
  linux: {
    arm64: [
      {
        triple: 'aarch64-unknown-linux-gnu',
        platformArchABI: 'linux-arm64-gnu',
        platform: 'linux',
        arch: 'arm64',
        abi: 'gnu',
      },
      {
        triple: 'aarch64-unknown-linux-musl',
        platformArchABI: 'linux-arm64-musl',
        platform: 'linux',
        arch: 'arm64',
        abi: 'musl',
      },
    ],
    arm: [
      {
        triple: 'arm-unknown-linux-gnueabi',
        platformArchABI: 'linux-arm-gnu',
        platform: 'linux',
        arch: 'arm',
        abi: 'gnu',
      },
      {
        triple: 'arm-unknown-linux-gnueabihf',
        platformArchABI: 'linux-arm-gnueabihf',
        platform: 'linux',
        arch: 'arm',
        abi: 'gnueabihf',
      },
      {
        triple: 'arm-unknown-linux-musleabi',
        platformArchABI: 'linux-arm-musl',
        platform: 'linux',
        arch: 'arm',
        abi: 'musl',
      },
      {
        triple: 'arm-unknown-linux-musleabihf',
        platformArchABI: 'linux-arm-musleabihf',
        platform: 'linux',
        arch: 'arm',
        abi: 'musleabihf',
      },
      {
        triple: 'armv7-unknown-linux-gnueabi',
        platformArchABI: 'linux-arm-gnu',
        platform: 'linux',
        arch: 'arm',
        abi: 'gnu',
      },
      {
        triple: 'armv7-unknown-linux-gnueabihf',
        platformArchABI: 'linux-arm-gnueabihf',
        platform: 'linux',
        arch: 'arm',
        abi: 'gnueabihf',
      },
      {
        triple: 'armv7-unknown-linux-musleabi',
        platformArchABI: 'linux-arm-musl',
        platform: 'linux',
        arch: 'arm',
        abi: 'musl',
      },
      {
        triple: 'armv7-unknown-linux-musleabihf',
        platformArchABI: 'linux-arm-musleabihf',
        platform: 'linux',
        arch: 'arm',
        abi: 'musleabihf',
      },
    ],
    armv5te: [
      {
        triple: 'armv5te-unknown-linux-gnueabi',
        platformArchABI: 'linux-armv5te-gnu',
        platform: 'linux',
        arch: 'armv5te',
        abi: 'gnu',
      },
      {
        triple: 'armv5te-unknown-linux-musleabi',
        platformArchABI: 'linux-armv5te-musl',
        platform: 'linux',
        arch: 'armv5te',
        abi: 'musl',
      },
    ],
    i586: [
      {
        triple: 'i586-unknown-linux-gnu',
        platformArchABI: 'linux-i586-gnu',
        platform: 'linux',
        arch: 'i586',
        abi: 'gnu',
      },
      {
        triple: 'i586-unknown-linux-musl',
        platformArchABI: 'linux-i586-musl',
        platform: 'linux',
        arch: 'i586',
        abi: 'musl',
      },
    ],
    ia32: [
      {
        triple: 'i686-unknown-linux-gnu',
        platformArchABI: 'linux-ia32-gnu',
        platform: 'linux',
        arch: 'ia32',
        abi: 'gnu',
      },
      {
        triple: 'i686-unknown-linux-musl',
        platformArchABI: 'linux-ia32-musl',
        platform: 'linux',
        arch: 'ia32',
        abi: 'musl',
      },
    ],
    loong64: [
      {
        triple: 'loongarch64-unknown-linux-gnu',
        platformArchABI: 'linux-loong64-gnu',
        platform: 'linux',
        arch: 'loong64',
        abi: 'gnu',
      },
      {
        triple: 'loongarch64-unknown-linux-musl',
        platformArchABI: 'linux-loong64-musl',
        platform: 'linux',
        arch: 'loong64',
        abi: 'musl',
      },
    ],
    powerpc: [
      {
        triple: 'powerpc-unknown-linux-gnu',
        platformArchABI: 'linux-powerpc-gnu',
        platform: 'linux',
        arch: 'powerpc',
        abi: 'gnu',
      },
    ],
    powerpc64: [
      {
        triple: 'powerpc64-unknown-linux-gnu',
        platformArchABI: 'linux-powerpc64-gnu',
        platform: 'linux',
        arch: 'powerpc64',
        abi: 'gnu',
      },
    ],
    ppc64: [
      {
        triple: 'powerpc64le-unknown-linux-gnu',
        platformArchABI: 'linux-ppc64-gnu',
        platform: 'linux',
        arch: 'ppc64',
        abi: 'gnu',
      },
      {
        triple: 'powerpc64le-unknown-linux-musl',
        platformArchABI: 'linux-ppc64-musl',
        platform: 'linux',
        arch: 'ppc64',
        abi: 'musl',
      },
    ],
    riscv64: [
      {
        triple: 'riscv64gc-unknown-linux-gnu',
        platformArchABI: 'linux-riscv64-gnu',
        platform: 'linux',
        arch: 'riscv64',
        abi: 'gnu',
      },
      {
        triple: 'riscv64gc-unknown-linux-musl',
        platformArchABI: 'linux-riscv64-musl',
        platform: 'linux',
        arch: 'riscv64',
        abi: 'musl',
      },
    ],
    s390x: [
      {
        triple: 's390x-unknown-linux-gnu',
        platformArchABI: 'linux-s390x-gnu',
        platform: 'linux',
        arch: 's390x',
        abi: 'gnu',
      },
    ],
    sparc64: [
      {
        triple: 'sparc64-unknown-linux-gnu',
        platformArchABI: 'linux-sparc64-gnu',
        platform: 'linux',
        arch: 'sparc64',
        abi: 'gnu',
      },
    ],
    thumbv7neon: [
      {
        triple: 'thumbv7neon-unknown-linux-gnueabihf',
        platformArchABI: 'linux-thumbv7neon-gnueabihf',
        platform: 'linux',
        arch: 'thumbv7neon',
        abi: 'gnueabihf',
      },
    ],
    x64: [
      {
        triple: 'x86_64-unknown-linux-gnu',
        platformArchABI: 'linux-x64-gnu',
        platform: 'linux',
        arch: 'x64',
        abi: 'gnu',
      },
      {
        triple: 'x86_64-unknown-linux-gnux32',
        platformArchABI: 'linux-x64-gnux32',
        platform: 'linux',
        arch: 'x64',
        abi: 'gnux32',
      },
      {
        triple: 'x86_64-unknown-linux-musl',
        platformArchABI: 'linux-x64-musl',
        platform: 'linux',
        arch: 'x64',
        abi: 'musl',
      },
    ],
  },
  openharmony: {
    arm64: [
      {
        triple: 'aarch64-unknown-linux-ohos',
        platformArchABI: 'openharmony-arm64',
        platform: 'openharmony',
        arch: 'arm64',
        abi: null,
      },
    ],
    arm: [
      {
        triple: 'armv7-unknown-linux-ohos',
        platformArchABI: 'openharmony-arm',
        platform: 'openharmony',
        arch: 'arm',
        abi: null,
      },
    ],
    x64: [
      {
        triple: 'x86_64-unknown-linux-ohos',
        platformArchABI: 'openharmony-x64',
        platform: 'openharmony',
        arch: 'x64',
        abi: null,
      },
    ],
  },
  freebsd: {
    ia32: [
      {
        triple: 'i686-unknown-freebsd',
        platformArchABI: 'freebsd-ia32',
        platform: 'freebsd',
        arch: 'ia32',
        abi: null,
      },
    ],
    x64: [
      {
        triple: 'x86_64-unknown-freebsd',
        platformArchABI: 'freebsd-x64',
        platform: 'freebsd',
        arch: 'x64',
        abi: null,
      },
    ],
  },
}
