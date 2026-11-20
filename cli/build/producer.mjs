#!/usr/bin/env node
// Build the host producer and stage it in cli/bin for npm packing.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(cliRoot, '..')
const binDir = join(cliRoot, 'bin')

const PROFILE = 'release'

const targetDir = JSON.parse(
  execFileSync(
    process.env.CARGO || 'cargo',
    ['metadata', '--no-deps', '--format-version', '1'],
    { cwd: repoRoot, env: process.env },
  ),
).target_directory

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { env: process.env }).toString(
    'utf8',
  )
  const line = out.split('\n').find((l) => l.startsWith('host: '))
  const triple = line?.slice('host: '.length).trim()
  if (!triple) {
    throw new Error(
      'napi-compress build: cannot read the host triple.\n' +
        '  Where:  rustc -vV\n' +
        '  Saw:    no "host:" line\n' +
        '  Fix:    ensure a working rustup/rustc is on PATH.',
    )
  }
  return triple
}

const triple = process.argv[2] || hostTriple()
const subcommand = process.env.ZIGBUILD === '1' ? 'zigbuild' : 'build'
execFileSync('rustup', ['target', 'add', triple], { stdio: 'inherit' })
const exeSuffix = triple.includes('windows') ? '.exe' : ''
const cmd = process.env.CARGO || 'cargo'
execFileSync(
  cmd,
  [subcommand, '-p', 'napi-compress', '--profile', PROFILE, '--target', triple],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  },
)

const built = join(targetDir, triple, PROFILE, `napi-compress${exeSuffix}`)
mkdirSync(binDir, { recursive: true })
const dest = join(binDir, `napi-compress-${triple}${exeSuffix}`)
copyFileSync(built, dest)
console.error(`producer: ${triple} -> ${dest}`)
