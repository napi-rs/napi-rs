export const createCargoConfig = (enableLinuxArm8Musl: boolean) => {
  const result: string[] = []
  if (enableLinuxArm8Musl) {
    result.push(`[target.aarch64-unknown-linux-musl]
linker = "aarch64-linux-musl-gcc"
rustflags = ["-C", "target-feature=-crt-static"]`)
  }
  return result.join('\n')
}
