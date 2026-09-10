import { stringify as stringifyToml } from '@std/toml'
import { dump as yamlDump } from 'js-yaml'

/**
 * Canonical JSON for files the CLI writes (package.json, napi config).
 *
 * Always 2-space indent and a POSIX trailing newline. Callers must not
 * add another `\n` or omit one — every JSON writer uses this helper.
 */
export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Canonical TOML for files the CLI rewrites (Cargo.toml).
 *
 * `@std/toml` stringify inserts a leading blank line, drops comments, and
 * emits `["a","b"]`. We cannot preserve comments through parse→stringify,
 * but we can match taplo/repo style for whitespace: no leading blank,
 * spaces after array commas, exactly one trailing newline.
 */
export function serializeToml(value: unknown): string {
  let serialized = stringifyToml(value)
  if (serialized.startsWith('\n')) {
    serialized = serialized.slice(1)
  }
  serialized = serialized.replace(
    / = \[([^\]]*)\]/g,
    (_match, inner: string) =>
      ` = [${inner
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .join(', ')}]`,
  )
  if (!serialized.endsWith('\n')) {
    serialized += '\n'
  }
  return serialized
}

/**
 * Canonical YAML for files the CLI rewrites (GitHub Actions workflows).
 *
 * Matches `napi new` / `napi rename` dump options and always ends with a
 * trailing newline. Blank lines from the original document are not
 * preserved — js-yaml dump cannot round-trip those.
 */
export function serializeYaml(value: unknown): string {
  const serialized = yamlDump(value, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  })
  return serialized.endsWith('\n') ? serialized : `${serialized}\n`
}
