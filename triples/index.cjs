
module.exports.platformArchTriples = {
  "darwin": {
    "arm64": [
      {
        "triple": "aarch64-apple-darwin",
        "platformArchABI": "darwin-arm64",
        "platform": "darwin",
        "arch": "arm64",
        "abi": null
      }
    ],
    "x64": [
      {
        "triple": "x86_64-apple-darwin",
        "platformArchABI": "darwin-x64",
        "platform": "darwin",
        "arch": "x64",
        "abi": null
      }
    ]
  },
  "ios": {
    "arm64": [
      {
        "triple": "aarch64-apple-ios",
        "platformArchABI": "ios-arm64",
        "platform": "ios",
        "arch": "arm64",
        "abi": null
      }
    ],
    "x64": [
      {
        "triple": "x86_64-apple-ios",
        "platformArchABI": "ios-x64",
        "platform": "ios",
        "arch": "x64",
        "abi": null
      }
    ]
  },
  "android": {
    "arm64": [
      {
        "triple": "aarch64-linux-android",
        "platformArchABI": "android-arm64",
        "platform": "android",
        "arch": "arm64",
        "abi": null
      }
    ],
    "arm": [
      {
        "triple": "armv7-linux-androideabi",
        "platformArchABI": "android-arm-eabi",
        "platform": "android",
        "arch": "arm",
        "abi": "eabi"
      }
    ],
    "ia32": [
      {
        "triple": "i686-linux-android",
        "platformArchABI": "android-ia32",
        "platform": "android",
        "arch": "ia32",
        "abi": null
      }
    ],
    "x64": [
      {
        "triple": "x86_64-linux-android",
        "platformArchABI": "android-x64",
        "platform": "android",
        "arch": "x64",
        "abi": null
      }
    ]
  },
  "win32": {
    "arm64": [
      {
        "triple": "aarch64-pc-windows-msvc",
        "platformArchABI": "win32-arm64-msvc",
        "platform": "win32",
        "arch": "arm64",
        "abi": "msvc"
      }
    ],
    "ia32": [
      {
        "triple": "i686-pc-windows-gnu",
        "platformArchABI": "win32-ia32-gnu",
        "platform": "win32",
        "arch": "ia32",
        "abi": "gnu"
      },
      {
        "triple": "i686-pc-windows-msvc",
        "platformArchABI": "win32-ia32-msvc",
        "platform": "win32",
        "arch": "ia32",
        "abi": "msvc"
      }
    ],
    "x64": [
      {
        "triple": "x86_64-pc-windows-gnu",
        "platformArchABI": "win32-x64-gnu",
        "platform": "win32",
        "arch": "x64",
        "abi": "gnu"
      },
      {
        "triple": "x86_64-pc-windows-msvc",
        "platformArchABI": "win32-x64-msvc",
        "platform": "win32",
        "arch": "x64",
        "abi": "msvc"
      }
    ]
  },
  "linux": {
    "arm64": [
      {
        "triple": "aarch64-unknown-linux-gnu",
        "platformArchABI": "linux-arm64-gnu",
        "platform": "linux",
        "arch": "arm64",
        "abi": "gnu"
      },
      {
        "triple": "aarch64-unknown-linux-musl",
        "platformArchABI": "linux-arm64-musl",
        "platform": "linux",
        "arch": "arm64",
        "abi": "musl"
      }
    ],
    "arm": [
      {
        "triple": "arm-unknown-linux-gnueabi",
        "platformArchABI": "linux-arm-gnu",
        "platform": "linux",
        "arch": "arm",
        "abi": "gnu"
      },
      {
        "triple": "arm-unknown-linux-gnueabihf",
        "platformArchABI": "linux-arm-gnueabihf",
        "platform": "linux",
        "arch": "arm",
        "abi": "gnueabihf"
      },
      {
        "triple": "arm-unknown-linux-musleabi",
        "platformArchABI": "linux-arm-musl",
        "platform": "linux",
        "arch": "arm",
        "abi": "musl"
      },
      {
        "triple": "arm-unknown-linux-musleabihf",
        "platformArchABI": "linux-arm-musleabihf",
        "platform": "linux",
        "arch": "arm",
        "abi": "musleabihf"
      },
      {
        "triple": "armv7-unknown-linux-gnueabi",
        "platformArchABI": "linux-arm-gnu",
        "platform": "linux",
        "arch": "arm",
        "abi": "gnu"
      },
      {
        "triple": "armv7-unknown-linux-gnueabihf",
        "platformArchABI": "linux-arm-gnueabihf",
        "platform": "linux",
        "arch": "arm",
        "abi": "gnueabihf"
      },
      {
        "triple": "armv7-unknown-linux-musleabi",
        "platformArchABI": "linux-arm-musl",
        "platform": "linux",
        "arch": "arm",
        "abi": "musl"
      },
      {
        "triple": "armv7-unknown-linux-musleabihf",
        "platformArchABI": "linux-arm-musleabihf",
        "platform": "linux",
        "arch": "arm",
        "abi": "musleabihf"
      }
    ],
    "armv5te": [
      {
        "triple": "armv5te-unknown-linux-gnueabi",
        "platformArchABI": "linux-armv5te-gnu",
        "platform": "linux",
        "arch": "armv5te",
        "abi": "gnu"
      },
      {
        "triple": "armv5te-unknown-linux-musleabi",
        "platformArchABI": "linux-armv5te-musl",
        "platform": "linux",
        "arch": "armv5te",
        "abi": "musl"
      }
    ],
    "ia32": [
      {
        "triple": "i686-unknown-linux-gnu",
        "platformArchABI": "linux-ia32-gnu",
        "platform": "linux",
        "arch": "ia32",
        "abi": "gnu"
      },
      {
        "triple": "i686-unknown-linux-musl",
        "platformArchABI": "linux-ia32-musl",
        "platform": "linux",
        "arch": "ia32",
        "abi": "musl"
      }
    ],
    "mips": [
      {
        "triple": "mips-unknown-linux-gnu",
        "platformArchABI": "linux-mips-gnu",
        "platform": "linux",
        "arch": "mips",
        "abi": "gnu"
      },
      {
        "triple": "mips-unknown-linux-musl",
        "platformArchABI": "linux-mips-musl",
        "platform": "linux",
        "arch": "mips",
        "abi": "musl"
      }
    ],
    "mips64": [
      {
        "triple": "mips64-unknown-linux-gnuabi64",
        "platformArchABI": "linux-mips64-gnuabi64",
        "platform": "linux",
        "arch": "mips64",
        "abi": "gnuabi64"
      },
      {
        "triple": "mips64-unknown-linux-muslabi64",
        "platformArchABI": "linux-mips64-muslabi64",
        "platform": "linux",
        "arch": "mips64",
        "abi": "muslabi64"
      }
    ],
    "mips64el": [
      {
        "triple": "mips64el-unknown-linux-gnuabi64",
        "platformArchABI": "linux-mips64el-gnuabi64",
        "platform": "linux",
        "arch": "mips64el",
        "abi": "gnuabi64"
      },
      {
        "triple": "mips64el-unknown-linux-muslabi64",
        "platformArchABI": "linux-mips64el-muslabi64",
        "platform": "linux",
        "arch": "mips64el",
        "abi": "muslabi64"
      }
    ],
    "mipsel": [
      {
        "triple": "mipsel-unknown-linux-gnu",
        "platformArchABI": "linux-mipsel-gnu",
        "platform": "linux",
        "arch": "mipsel",
        "abi": "gnu"
      },
      {
        "triple": "mipsel-unknown-linux-musl",
        "platformArchABI": "linux-mipsel-musl",
        "platform": "linux",
        "arch": "mipsel",
        "abi": "musl"
      }
    ],
    "powerpc": [
      {
        "triple": "powerpc-unknown-linux-gnu",
        "platformArchABI": "linux-powerpc-gnu",
        "platform": "linux",
        "arch": "powerpc",
        "abi": "gnu"
      }
    ],
    "powerpc64": [
      {
        "triple": "powerpc64-unknown-linux-gnu",
        "platformArchABI": "linux-powerpc64-gnu",
        "platform": "linux",
        "arch": "powerpc64",
        "abi": "gnu"
      }
    ],
    "powerpc64le": [
      {
        "triple": "powerpc64le-unknown-linux-gnu",
        "platformArchABI": "linux-powerpc64le-gnu",
        "platform": "linux",
        "arch": "powerpc64le",
        "abi": "gnu"
      }
    ],
    "riscv64gc": [
      {
        "triple": "riscv64gc-unknown-linux-gnu",
        "platformArchABI": "linux-riscv64gc-gnu",
        "platform": "linux",
        "arch": "riscv64gc",
        "abi": "gnu"
      }
    ],
    "s390x": [
      {
        "triple": "s390x-unknown-linux-gnu",
        "platformArchABI": "linux-s390x-gnu",
        "platform": "linux",
        "arch": "s390x",
        "abi": "gnu"
      }
    ],
    "sparc64": [
      {
        "triple": "sparc64-unknown-linux-gnu",
        "platformArchABI": "linux-sparc64-gnu",
        "platform": "linux",
        "arch": "sparc64",
        "abi": "gnu"
      }
    ],
    "x64": [
      {
        "triple": "x86_64-unknown-linux-gnu",
        "platformArchABI": "linux-x64-gnu",
        "platform": "linux",
        "arch": "x64",
        "abi": "gnu"
      },
      {
        "triple": "x86_64-unknown-linux-gnux32",
        "platformArchABI": "linux-x64-gnux32",
        "platform": "linux",
        "arch": "x64",
        "abi": "gnux32"
      },
      {
        "triple": "x86_64-unknown-linux-musl",
        "platformArchABI": "linux-x64-musl",
        "platform": "linux",
        "arch": "x64",
        "abi": "musl"
      }
    ]
  },
  "freebsd": {
    "ia32": [
      {
        "triple": "i686-unknown-freebsd",
        "platformArchABI": "freebsd-ia32",
        "platform": "freebsd",
        "arch": "ia32",
        "abi": null
      }
    ],
    "x64": [
      {
        "triple": "x86_64-unknown-freebsd",
        "platformArchABI": "freebsd-x64",
        "platform": "freebsd",
        "arch": "x64",
        "abi": null
      }
    ]
  }
}
