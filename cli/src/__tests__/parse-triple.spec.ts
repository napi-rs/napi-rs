import test from 'ava'

import { parseTriple } from '../parse-triple'

const triples = [
  {
    name: 'x86_64-unknown-linux-musl',
    expected: {
      abi: 'musl',
      arch: 'x64',
      platform: 'linux',
      platformArchABI: 'linux-x64-musl',
      raw: 'x86_64-unknown-linux-musl',
    } as const,
  },
  {
    name: 'x86_64-unknown-linux-gnu',
    expected: {
      abi: 'gnu',
      arch: 'x64',
      platform: 'linux',
      platformArchABI: 'linux-x64-gnu',
      raw: 'x86_64-unknown-linux-gnu',
    } as const,
  },
  {
    name: 'x86_64-pc-windows-msvc',
    expected: {
      abi: 'msvc',
      arch: 'x64',
      platform: 'win32',
      platformArchABI: 'win32-x64-msvc',
      raw: 'x86_64-pc-windows-msvc',
    } as const,
  },
  {
    name: 'x86_64-apple-darwin',
    expected: {
      abi: null,
      arch: 'x64',
      platform: 'darwin',
      platformArchABI: 'darwin-x64',
      raw: 'x86_64-apple-darwin',
    } as const,
  },
  {
    name: 'i686-pc-windows-msvc',
    expected: {
      abi: 'msvc',
      arch: 'ia32',
      platform: 'win32',
      platformArchABI: 'win32-ia32-msvc',
      raw: 'i686-pc-windows-msvc',
    } as const,
  },
  {
    name: 'x86_64-unknown-freebsd',
    expected: {
      abi: null,
      arch: 'x64',
      platform: 'freebsd',
      platformArchABI: 'freebsd-x64',
      raw: 'x86_64-unknown-freebsd',
    } as const,
  },
  {
    name: 'aarch64-unknown-linux-gnu',
    expected: {
      abi: 'gnu',
      arch: 'arm64',
      platform: 'linux',
      platformArchABI: 'linux-arm64-gnu',
      raw: 'aarch64-unknown-linux-gnu',
    } as const,
  },
  {
    name: 'aarch64-pc-windows-msvc',
    expected: {
      abi: 'msvc',
      arch: 'arm64',
      platform: 'win32',
      platformArchABI: 'win32-arm64-msvc',
      raw: 'aarch64-pc-windows-msvc',
    } as const,
  },
  {
    name: 'armv7-unknown-linux-gnueabihf',
    expected: {
      abi: 'gnueabihf',
      arch: 'arm',
      platform: 'linux',
      platformArchABI: 'linux-arm-gnueabihf',
      raw: 'armv7-unknown-linux-gnueabihf',
    } as const,
  },
  {
    name: 'aarch64-linux-android',
    expected: {
      abi: null,
      arch: 'arm64',
      platform: 'android',
      platformArchABI: 'android-arm64',
      raw: 'aarch64-linux-android',
    },
  } as const,
  {
    name: 'armv7-linux-androideabi',
    expected: {
      abi: 'eabi',
      arch: 'arm',
      platform: 'android',
      platformArchABI: 'android-arm-eabi',
      raw: 'armv7-linux-androideabi',
    },
  } as const,
]

for (const triple of triples) {
  test(`should parse ${triple.name}`, (t) => {
    t.deepEqual(parseTriple(triple.name), triple.expected)
  })
}
