// lint-staged entry point for staged Rust sources.
//
// `cargo fmt -- <file>` appends the extra file arguments to every
// per-edition rustfmt invocation cargo-fmt makes, so in a workspace that
// mixes editions (the edition-2024 `crates/async-runtime` next to the
// edition-2021 crates) the `rustfmt --edition 2021 <staged file> <2021
// files…>` invocation fails to parse edition-2024 syntax such as
// let-chains. The rustfmt.toml `edition` cannot fix that either: cargo-fmt
// always passes `--edition` on the command line, which overrides the
// config file.
//
// Mirror what cargo-fmt itself does instead: resolve every staged file to
// its owning package's edition and run one rustfmt per edition group.
// `style_edition` then falls back to that same per-file edition, exactly
// matching the `cargo fmt --all` output CI checks with
// `cargo fmt -- --check`.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

// cargo defaults unspecified editions to 2015, but every package in this
// workspace declares one; the fallback only guards files outside a package.
const FALLBACK_EDITION = '2021'

function manifestEdition(manifest) {
  return manifest.match(/^\s*edition\s*=\s*"(\d{4})"/m)?.[1]
}

function workspaceEdition(startDirectory) {
  let directory = startDirectory
  const { root } = parse(directory)
  for (;;) {
    const manifestPath = join(directory, 'Cargo.toml')
    if (existsSync(manifestPath)) {
      const manifest = readFileSync(manifestPath, 'utf8')
      if (/^\s*\[workspace\.package\]/m.test(manifest)) {
        const edition = manifestEdition(manifest)
        if (edition) {
          return edition
        }
      }
    }
    if (directory === root) {
      return FALLBACK_EDITION
    }
    directory = dirname(directory)
  }
}

function packageEdition(startDirectory) {
  let directory = startDirectory
  const { root } = parse(directory)
  for (;;) {
    const manifestPath = join(directory, 'Cargo.toml')
    if (existsSync(manifestPath)) {
      const manifest = readFileSync(manifestPath, 'utf8')
      if (/^\s*\[package\]/m.test(manifest)) {
        const edition = manifestEdition(manifest)
        if (edition) {
          return edition
        }
        if (/^\s*edition\.workspace\s*=\s*true/m.test(manifest)) {
          return workspaceEdition(dirname(directory))
        }
        return FALLBACK_EDITION
      }
    }
    if (directory === root) {
      return FALLBACK_EDITION
    }
    directory = dirname(directory)
  }
}

const files = process.argv.slice(2)
const filesByEdition = new Map()
for (const file of files) {
  const edition = packageEdition(dirname(file))
  const group = filesByEdition.get(edition)
  if (group) {
    group.push(file)
  } else {
    filesByEdition.set(edition, [file])
  }
}

for (const [edition, groupedFiles] of filesByEdition) {
  execFileSync('rustfmt', ['--edition', edition, ...groupedFiles], {
    stdio: 'inherit',
  })
}
