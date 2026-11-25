import { statSync } from 'node:fs'

/**
 * Strip bundler query/fragment suffixes (`?…`, `#…`) from a resolved module ID
 * without truncating literal `#` or `?` characters that belong to the on-disk
 * path (for example, a workspace directory named `napi#3740`).
 */
export function resolveModuleFilePath(id) {
  let candidate = id
  while (candidate.length > 0) {
    let isFile = false
    try {
      isFile = Boolean(statSync(candidate, { throwIfNoEntry: false })?.isFile())
    } catch (error) {
      if (
        error?.code !== 'ENAMETOOLONG' &&
        error?.code !== 'EINVAL' &&
        error?.code !== 'ENOTDIR'
      ) {
        throw error
      }
    }
    if (isFile) {
      return candidate
    }
    const cut = Math.max(candidate.lastIndexOf('?'), candidate.lastIndexOf('#'))
    if (cut <= 0) {
      break
    }
    candidate = candidate.slice(0, cut)
  }
  return id
}
