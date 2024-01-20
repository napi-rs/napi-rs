export const createCargoConfig = (
  enableLinuxArm8Musl: boolean,
  enableWindowsX64: boolean,
) => {
  const result: string[] = []
  if (enableLinuxArm8Musl) {
    result.push(`[target.aarch64-unknown-linux-musl]
linker = "aarch64-linux-musl-gcc"
rustflags = ["-C", "target-feature=-crt-static"]`)
  }
  if (enableWindowsX64) {
    result.push(`[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "target-feature=+crt-static"]`)
  }
  return result.join('\n')
}
