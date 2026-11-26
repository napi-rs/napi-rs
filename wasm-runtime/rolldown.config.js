import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { defineConfig } from 'rolldown'
import { replacePlugin as replace } from 'rolldown/plugins'

import { resolveModuleFilePath } from './resolve-module-file-path.js'

// The bundled plugins use private core context fields. Build them only from
// the exact v2 version the package tests run against, which must also be the
// v2 version in the peer range. `emnapi-plugins.js` adapts them to the
// 2.0.0-alpha context, and the CommonJS entry passes a v2 binding's own
// `@emnapi/core/plugins` when it can find them.
const require = createRequire(import.meta.url)
const { version: coreVersion } = require('@emnapi/core/package.json')
const {
  name: selfPackageName,
  devDependencies,
  peerDependencies,
} = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
if (
  coreVersion !== devDependencies['@emnapi/core'] ||
  coreVersion !== devDependencies['@emnapi/runtime'] ||
  !peerDependencies['@emnapi/core'].split(' || ').includes(coreVersion) ||
  !peerDependencies['@emnapi/runtime'].split(' || ').includes(coreVersion)
) {
  throw new Error(
    `Bundled emnapi ${coreVersion} must match the exact v2 development and peer versions`,
  )
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeLicense(pkg) {
  if (typeof pkg.license === 'string' && pkg.license.trim().length > 0) {
    return pkg.license.trim()
  }
  if (
    pkg.license &&
    typeof pkg.license === 'object' &&
    typeof pkg.license.type === 'string' &&
    pkg.license.type.trim().length > 0
  ) {
    return pkg.license.type.trim()
  }
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses
      .map((entry) =>
        typeof entry === 'string'
          ? entry.trim()
          : typeof entry?.type === 'string'
            ? entry.type.trim()
            : '',
      )
      .filter(Boolean)
    if (types.length > 0) {
      return types.join(' OR ')
    }
  }
  return null
}

function normalizeAuthor(author) {
  if (typeof author === 'string' && author.trim().length > 0) {
    return author.trim()
  }
  if (author && typeof author === 'object') {
    const parts = []
    if (typeof author.name === 'string' && author.name.trim().length > 0) {
      parts.push(author.name.trim())
    }
    if (typeof author.email === 'string' && author.email.trim().length > 0) {
      parts.push(`<${author.email.trim()}>`)
    }
    if (typeof author.url === 'string' && author.url.trim().length > 0) {
      parts.push(`(${author.url.trim()})`)
    }
    if (parts.length > 0) {
      return parts.join(' ')
    }
  }
  return null
}

function normalizeRepository(repository) {
  if (typeof repository === 'string' && repository.trim().length > 0) {
    return repository.trim()
  }
  if (
    repository &&
    typeof repository === 'object' &&
    typeof repository.url === 'string' &&
    repository.url.trim().length > 0
  ) {
    return repository.url.trim()
  }
  return null
}

function normalizeText(text) {
  return text.replace(/\r\n?/g, '\n').trimEnd()
}

function findPackageRoot(filePath) {
  let dir = dirname(filePath)
  while (true) {
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (
        typeof pkg.name === 'string' &&
        pkg.name.length > 0 &&
        typeof pkg.version === 'string' &&
        pkg.version.length > 0
      ) {
        return { dir, pkg }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return null
    }
    dir = parent
  }
}

function pickPackageDocFile(dir, patterns) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort(compareCodeUnits)
  for (const pattern of patterns) {
    const match = entries.find((name) => pattern.test(name))
    if (match) {
      return match
    }
  }
  return null
}

function formatThirdPartyLicense(bundlePath, packages) {
  const sections = [
    `Third-party software bundled in ${selfPackageName} (${bundlePath}):`,
  ]
  for (const pkg of packages) {
    const lines = [
      `${pkg.name}@${pkg.version}`,
      `License: ${pkg.license ?? 'UNKNOWN'}`,
    ]
    if (pkg.author) {
      lines.push(`Author: ${pkg.author}`)
    }
    if (pkg.repository) {
      lines.push(`Repository: ${pkg.repository}`)
    }
    if (pkg.licenseText) {
      lines.push('', pkg.licenseText)
    }
    if (pkg.noticeText) {
      lines.push('', `Notice (${pkg.noticeFile}):`, '', pkg.noticeText)
    }
    sections.push(lines.join('\n'))
  }
  return `${sections.join('\n\n---\n\n')}\n`
}

function emitBundledPackagesManifestPlugin({
  bundlePath,
  manifestFileName,
  licenseFileName,
}) {
  return {
    name: 'emit-bundled-packages-manifest',
    generateBundle(_outputOptions, bundle) {
      const packagesByKey = new Map()
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') {
          continue
        }
        for (const id of output.moduleIds) {
          if (id.startsWith('\0') || id.startsWith('rolldown:')) {
            continue
          }
          const cleanId = resolveModuleFilePath(id)
          const found = findPackageRoot(cleanId)
          if (!found) {
            throw new Error(
              `Unable to resolve package.json for bundled module: ${cleanId}`,
            )
          }
          if (found.pkg.name === selfPackageName) {
            continue
          }
          const key = `${found.pkg.name}@${found.pkg.version}`
          if (packagesByKey.has(key)) {
            continue
          }
          const licenseFile = pickPackageDocFile(found.dir, [
            /^licen[cs]e(?:\.(?:md|txt|markdown))?$/i,
            /^copying(?:\.(?:md|txt|markdown))?$/i,
          ])
          const licenseText = licenseFile
            ? normalizeText(readFileSync(join(found.dir, licenseFile), 'utf8'))
            : null
          const noticeFile = pickPackageDocFile(found.dir, [
            /^notice(?:\.(?:md|txt|markdown))?$/i,
          ])
          const noticeText = noticeFile
            ? normalizeText(readFileSync(join(found.dir, noticeFile), 'utf8'))
            : null
          packagesByKey.set(key, {
            name: found.pkg.name,
            version: found.pkg.version,
            license: normalizeLicense(found.pkg),
            author: normalizeAuthor(found.pkg.author),
            repository: normalizeRepository(found.pkg.repository),
            licenseFile,
            licenseText,
            ...(noticeFile ? { noticeFile, noticeText } : {}),
          })
        }
      }

      const packages = [...packagesByKey.values()].sort(
        (left, right) =>
          compareCodeUnits(left.name, right.name) ||
          compareCodeUnits(left.version, right.version),
      )

      this.emitFile({
        type: 'asset',
        fileName: manifestFileName,
        source: `${JSON.stringify(
          {
            schemaVersion: 1,
            bundle: bundlePath,
            packages,
          },
          null,
          2,
        )}\n`,
      })
      this.emitFile({
        type: 'asset',
        fileName: licenseFileName,
        source: formatThirdPartyLicense(bundlePath, packages),
      })
    },
  }
}

export default defineConfig([
  {
    input: './fs.js',
    platform: 'browser',
    resolve: {
      alias: {
        'node:events': 'events',
        'node:path': 'path-browserify',
        'node:stream': 'readable-stream',
        assert: join(import.meta.dirname, 'assert.cjs'),
        util: join(import.meta.dirname, 'util'),
        'node:buffer': 'buffer',
        'node:url': join(import.meta.dirname, 'url'),
      },
    },
    transform: {
      inject: {
        process: ['process', 'default'],
        Buffer: ['buffer', 'Buffer'],
      },
    },
    plugins: [
      replace(
        {
          'process.env.NODE_ENV': '"production"',
          'process.env.NODE_DEBUG': false,
          global: undefined,
        },
        { preventAssignment: false },
      ),
      emitBundledPackagesManifestPlugin({
        bundlePath: 'dist/fs.js',
        manifestFileName: 'fs.packages.json',
        licenseFileName: 'THIRD-PARTY-LICENSE',
      }),
    ],
    output: {
      format: 'esm',
      dir: './dist',
    },
  },
  {
    input: './fs-proxy.js',
    output: {
      format: 'commonjs',
      file: './dist/fs-proxy.cjs',
    },
  },
  {
    input: './emnapi-plugins.js',
    output: [
      {
        format: 'esm',
        file: './dist/emnapi-plugins.js',
      },
      {
        format: 'commonjs',
        exports: 'named',
        file: './dist/emnapi-plugins.cjs',
      },
    ],
  },
  {
    input: './emnapi-compat.js',
    output: [
      {
        format: 'esm',
        file: './dist/emnapi-compat.js',
      },
      {
        format: 'commonjs',
        exports: 'named',
        file: './dist/emnapi-compat.cjs',
      },
    ],
  },
  {
    input: './emnapi-pairing.js',
    output: [
      {
        format: 'esm',
        file: './dist/emnapi-pairing.js',
      },
      {
        format: 'commonjs',
        exports: 'named',
        file: './dist/emnapi-pairing.cjs',
      },
    ],
  },
])
