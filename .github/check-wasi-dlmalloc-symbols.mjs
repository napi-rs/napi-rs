// Checks that a wasm32-wasip1-threads `libc.a` still has the allocator shape napi's heap sync
// depends on (crates/napi/src/wasi_heap_sync.rs). napi-build links every addon with `--wrap`
// for the symbols in `HEAP_SYNC_WRAPPED_SYMBOLS` (crates/build/src/wasi.rs); an entry that a
// later wasi-libc adds to its allocator would silently skip the lock. So, for each archive:
//
// - the member that defines `malloc` (dlmalloc) defines exactly the wrapped allocator names;
// - `sbrk` is defined in another member, and only the allocator member references it;
// - the allocator member references no other libc symbol than the recorded set, so it never
//   calls back into a wrapped entry (the lock is not re-entrant).
//
// Usage: node .github/check-wasi-dlmalloc-symbols.mjs <libc.a>...
// llvm-nm comes from LLVM_NM, else $WASI_SDK_PATH/bin/llvm-nm, else PATH.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The libc symbols dlmalloc's object references, as of wasi-sdk 32-34 and rustc's
// self-contained libc. Linker-defined symbols (`__heap_base`, `__stack_pointer`, ...) are not
// in libc.a and are not checked.
const ALLOCATOR_LIBC_REFERENCES = ['errno', 'sbrk', 'sched_yield']

const archives = process.argv.slice(2)
if (archives.length === 0) {
  throw new Error('usage: check-wasi-dlmalloc-symbols.mjs <libc.a>...')
}

const wasiSource = readFileSync(
  new URL('../crates/build/src/wasi.rs', import.meta.url),
  'utf8',
)
const list = wasiSource.match(
  /const HEAP_SYNC_WRAPPED_SYMBOLS: \[&str; \d+\] = \[([^\]]*)\]/,
)
if (!list) {
  throw new Error(
    'HEAP_SYNC_WRAPPED_SYMBOLS not found in crates/build/src/wasi.rs',
  )
}
const wrapped = [...list[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
const allocatorNames = wrapped.filter((name) => name !== 'sbrk').sort()
if (!wrapped.includes('sbrk') || allocatorNames.length !== wrapped.length - 1) {
  throw new Error(`unexpected HEAP_SYNC_WRAPPED_SYMBOLS: ${wrapped.join(', ')}`)
}

const llvmNm =
  process.env.LLVM_NM ??
  (process.env.WASI_SDK_PATH
    ? join(process.env.WASI_SDK_PATH, 'bin', 'llvm-nm')
    : 'llvm-nm')

/** `member -> { defined: Set, undefined: Set }` for the global symbols of one archive. */
function readArchive(archive) {
  const members = new Map()
  for (const [flag, kind] of [
    ['--defined-only', 'defined'],
    ['--undefined-only', 'undefined'],
  ]) {
    const output = execFileSync(
      llvmNm,
      ['--print-file-name', '--extern-only', flag, archive],
      // llvm-nm prints "no symbols" to stderr for empty members; keep it off the log.
      {
        encoding: 'utf8',
        maxBuffer: 64 << 20,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    for (const line of output.split('\n')) {
      // `<archive>:<member>: [<value>] <type> <name>`
      const match = line.match(
        /^.*:([^:]+):\s+(?:[0-9a-f]+\s+)?[A-Za-z]\s+(\S+)$/,
      )
      if (!match) continue
      const [, member, name] = match
      if (!members.has(member)) {
        members.set(member, { defined: new Set(), undefined: new Set() })
      }
      members.get(member)[kind].add(name)
    }
  }
  return members
}

const sorted = (values) => [...values].sort()
let failed = false

for (const archive of archives) {
  const problems = []
  const members = readArchive(archive)
  const definedIn = (name) =>
    [...members].filter(([, symbols]) => symbols.defined.has(name))
  const allocators = definedIn('malloc')
  if (allocators.length !== 1) {
    problems.push(`malloc is defined in ${allocators.length} members`)
  } else {
    const [allocatorMember, allocator] = allocators[0]
    const allocatorDefines = sorted(allocator.defined)
    if (allocatorDefines.join() !== allocatorNames.join()) {
      problems.push(
        `${allocatorMember} defines [${allocatorDefines.join(', ')}], napi-build wraps [${allocatorNames.join(', ')}]`,
      )
    }
    for (const name of allocatorNames) {
      const owners = definedIn(name).map(([member]) => member)
      if (owners.length !== 1) {
        problems.push(`${name} is defined in [${owners.join(', ')}]`)
      }
    }
    const sbrkOwners = definedIn('sbrk').map(([member]) => member)
    if (sbrkOwners.length !== 1 || sbrkOwners[0] === allocatorMember) {
      problems.push(`sbrk is defined in [${sbrkOwners.join(', ')}]`)
    }
    const sbrkUsers = [...members]
      .filter(([, symbols]) => symbols.undefined.has('sbrk'))
      .map(([member]) => member)
    if (sbrkUsers.join() !== allocatorMember) {
      problems.push(
        `sbrk is referenced by [${sbrkUsers.join(', ')}], not only by ${allocatorMember}`,
      )
    }
    const libcReferences = sorted(allocator.undefined).filter(
      (name) => definedIn(name).length > 0,
    )
    if (libcReferences.join() !== ALLOCATOR_LIBC_REFERENCES.join()) {
      problems.push(
        `${allocatorMember} references libc [${libcReferences.join(', ')}], recorded [${ALLOCATOR_LIBC_REFERENCES.join(', ')}]`,
      )
    }
  }
  if (problems.length > 0) {
    failed = true
    console.error(`FAIL ${archive}`)
    for (const problem of problems) console.error(`  ${problem}`)
  } else {
    console.log(
      `OK ${archive}: the allocator defines exactly [${allocatorNames.join(', ')}] and calls only [${ALLOCATOR_LIBC_REFERENCES.join(', ')}]`,
    )
  }
}

if (failed) {
  console.error(
    "napi's heap-sync wrap list (HEAP_SYNC_WRAPPED_SYMBOLS in crates/build/src/wasi.rs) no longer matches wasi-libc's allocator: update the list, napi's wrappers in crates/napi/src/wasi_heap_sync.rs, and this check together.",
  )
  process.exitCode = 1
}
