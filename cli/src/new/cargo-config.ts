export const createCargoConfig = (
  enableLinuxArm7: boolean,
  enableLinuxArm8: boolean,
) => {
  let result = ''
  if (enableLinuxArm7) {
    result = `[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"`
  }
  if (enableLinuxArm8) {
    result = `${result}

[target.armv7-unknown-linux-gnueabihf]
linker = "arm-linux-gnueabihf-gcc"
`
  }
  return result
}
