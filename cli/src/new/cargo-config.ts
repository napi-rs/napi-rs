export const createCargoConfig = (
  enableLinuxArm7: boolean,
  enableLinuxArm8Gnu: boolean,
  enableLinuxArm8Musl: boolean,
) => {
  const result: string[] = []
  if (enableLinuxArm8Gnu) {
    result.push(`[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"`)
  }
  if (enableLinuxArm8Musl) {
    result.push(`[target.aarch64-unknown-linux-musl]
linker = "aarch64-linux-musl-gcc"
rustflags = ["-C", "target-feature=-crt-static"]`)
  }
  if (enableLinuxArm7) {
    result.push(`[target.armv7-unknown-linux-gnueabihf]
linker = "arm-linux-gnueabihf-gcc"`)
  }
  return result.join('\n')
}
