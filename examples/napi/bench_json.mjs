import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const napi = require('./index.cjs')

// ─── Enum — mirrors #[napi(string_enum)] pub enum FieldType ───
const Type = {
  String: 'string', I64: 'i64', F64: 'f64',
  Bool: 'bool', Json: 'json',
  ArrayString: 'array:string', ArrayI64: 'array:i64', ArrayF64: 'array:f64',
}

// ─── Build DynamicSchema once ───
const schema = new napi.DynamicSchema()
schema.register('users', [
  { name: 'id', type: Type.I64 },
  { name: 'name', type: Type.String },
  { name: 'email', type: Type.String },
  { name: 'score', type: Type.F64, optional: true },
  { name: 'tags', type: Type.ArrayString, optional: true },
])

// ─── Test data ───
const logObj = {
  timestamp: '2025-01-01T00:00:00Z', level: 'INFO',
  message: 'server started successfully with 42 connections',
  tags: ['boot', 'system', 'init', 'network'],
}
const logStr = JSON.stringify(logObj)
const logBuf = Buffer.from(logStr)

const userObj = { id: 1, name: 'Alice', email: 'a@x.com', score: 99.5, tags: ['admin'] }
const userStr = JSON.stringify(userObj)
const userBuf = Buffer.from(userStr)

const tenUsers = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1, name: `User${i}`, email: `u${i}@x.com`,
  score: Math.random() * 100, tags: ['tag1', 'tag2'],
}))
const tenBuf = Buffer.from(JSON.stringify(tenUsers))
const tenStr = JSON.stringify(tenUsers)

// ─── Warmup JIT ───
for (let i = 0; i < 3000; i++) {
  napi.benchZeroCopy(logBuf); napi.benchOwnedStr(logStr)
  napi.benchDirectLog(logObj); schema.parseOne('users', userBuf)
  schema.validateObject('users', userObj)
  JSON.parse(logStr)
}

const ITER = 50_000

function run(fn, iter = ITER) {
  const t0 = typeof Bun !== 'undefined' ? Bun.nanoseconds() : Number(process.hrtime.bigint())
  for (let i = 0; i < iter; i++) fn()
  const ns = (typeof Bun !== 'undefined' ? Bun.nanoseconds() : Number(process.hrtime.bigint())) - t0
  const ops = Math.round(iter / (ns / 1e9))
  const msPerOp = (ns / 1e6 / iter).toFixed(3)
  return { ops, msPerOp }
}

// Get baseline: JSON.parse speed
const baseline = run(() => JSON.parse(logStr))

// ─── All benchmarks ───
const benchmarks = [
  // Section 1: Compile-time Rust structs (reference)
  { section: 'Compile-time Rust structs (reference)' },
  { label: 'owned-str  serde_json::from_str into struct', fn: () => napi.benchOwnedStr(logStr) },
  { label: 'zero-copy  Buffer → serde_json::from_slice', fn: () => napi.benchZeroCopy(logBuf) },
  { label: 'direct-js  JS Object → env.from_js_value',   fn: () => napi.benchDirectLog(logObj) },
  { label: 'two-step   JSON.parse then pass to Rust',     fn: () => napi.benchDirectLog(JSON.parse(logStr)) },

  // Section 2: DynamicSchema (streaming parser, serde_json Value → JS)
  { section: 'DynamicSchema — streaming parser (serde_json Value → JS)' },
  { label: 'parseOne      1 record from Buffer', fn: () => schema.parseOne('users', userBuf) },
  { label: 'parse         10 records from Buffer', fn: () => schema.parse('users', tenBuf) },
  { label: 'parseString   10 records from String', fn: () => schema.parseString('users', tenStr) },

  // Section 3: DynamicSchema — direct napi validation (no Value)
  { section: 'DynamicSchema — direct napi validation (no serde_json Value)' },
  { label: 'validate      JS Object → Value → validate → Value → JS', fn: () => schema.validate('users', userObj) },
  { label: 'validateObj   JS Object validated via napi direct access', fn: () => schema.validateObject('users', userObj) },

  // Section 4: Pure JS equivalents
  { section: 'Pure JavaScript (reference)' },
  { label: 'JSON.parse 1 record (JS only)', fn: () => JSON.parse(userStr) },
  { label: 'JSON.parse 10 records (JS)',   fn: () => JSON.parse(tenStr) },
  { label: 'JSON.parse + manual validate', fn: () => { for (const r of JSON.parse(tenStr)) { if (typeof r.id !== 'number') throw Error() } } },
]

// Compute per-record ops for batch operations
function perRecord(ops, batchSize) {
  return Math.round(ops * batchSize)
}

console.log()
console.log('  ╔══════════════════════════════════════════════════════════════════════════════╗')
console.log('  ║                      JSON Performance Benchmark                           ║')
console.log(`  ║                     ${(ITER/1000).toFixed(0)}k iterations, release build                               ║`)
console.log('  ╚══════════════════════════════════════════════════════════════════════════════╝')
console.log()

let sectionPrinted = 0
for (const b of benchmarks) {
  if (b.section) {
    if (sectionPrinted > 0) console.log()
    console.log(`  ── ${b.section} ──`)
    console.log(`  ${'Method'.padEnd(55)} ${'ops/s'.padStart(12)} ${'records/s'.padStart(12)} ${'vs JSON.parse'.padStart(13)} ${'ms/op'.padStart(8)}`)
    console.log(`  ${'─'.repeat(100)}`)
    sectionPrinted++
    continue
  }

  const r = run(b.fn)
  const ratio = ((r.ops / baseline.ops) * 100).toFixed(1)
  const isBatch = b.label.includes('10 records')
  const recLabel = isBatch ? ` (${(r.ops * 10 / 1000).toFixed(0)}k/s)` : ''

  console.log(`  ${b.label.padEnd(50)} ${r.ops.toLocaleString().padStart(10)} ${(isBatch ? perRecord(r.ops, 10).toLocaleString() : '—').padStart(10)} ${`${ratio}%`.padStart(12)} ${r.msPerOp.padStart(8)}`)
}

// ─── Summary ───
console.log()
console.log('  ╔══════════════════════════════════════════════════════════════════════════════╗')
console.log('  ║                               SUMMARY                                     ║')
console.log('  ╚══════════════════════════════════════════════════════════════════════════════╝')
console.log()

const compileTime = run(() => napi.benchOwnedStr(logStr))
const parseOne = run(() => schema.parseOne('users', userBuf))
const validateObj = run(() => schema.validateObject('users', userObj))

console.log(`  Fastest parse (Rust):    parseOne ${parseOne.ops.toLocaleString()} ops/s (${(parseOne.ops / compileTime.ops * 100).toFixed(0)}% of compile-time)`)
console.log(`  Fastest validate (Rust): validateObject ${validateObj.ops.toLocaleString()} ops/s (${(validateObj.ops / parseOne.ops).toFixed(1)}x faster than parseOne)`)
console.log(`  Fastest overall:          JSON.parse() in JS at ${baseline.ops.toLocaleString()} ops/s`)
console.log()
console.log(`  💡 Optimal pipeline: JSON.parse(obj) → schema.validateObject('users', obj)`)
console.log(`     JSON.parse at ${baseline.ops.toLocaleString()} ops/s + validateObject at ${validateObj.ops.toLocaleString()} ops/s`)
console.log()
