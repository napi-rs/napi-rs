import { execSync } from 'node:child_process'

import { debug } from './log.js'

export function tryInstallCargoBinary(name: string, bin: string) {
  if (detectCargoBinary(bin)) {
    debug('Cargo binary already installed: %s', name)
    return
  }

  try {
    debug('Installing cargo binary: %s', name)
    execSync(`cargo install ${name}`, {
      stdio: 'inherit',
    })
  } catch (e) {
    throw new Error(`Failed to install cargo binary: ${name}`, {
      cause: e,
    })
  }
}

function detectCargoBinary(bin: string) {
  debug('Detecting cargo binary: %s', bin)
  try {
    execSync(`cargo help ${bin}`, {
      stdio: 'ignore',
    })
    debug('Cargo binary detected: %s', bin)
    return true
  } catch {
    debug('Cargo binary not detected: %s', bin)
    return false
  }
}
