import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const napi = require('./index.cjs')

const Type = {
  String: 'string', I64: 'i64', F64: 'f64',
  Bool: 'bool', Json: 'json',
  ArrayString: 'array:string', ArrayI64: 'array:i64', ArrayF64: 'array:f64',
}

let passed = 0, failed = 0
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('FAIL:', msg) } }
function assertEq(a, b, msg) {
  if (a === b) passed++; else { failed++; console.error(`FAIL: ${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
}
function assertThrows(fn, msg) { try { fn(); failed++; console.error('FAIL:', msg) } catch (e) { passed++ } }

const s = new napi.DynamicSchema()
s.register('users', [
  { name: 'id', type: Type.I64 },
  { name: 'name', type: Type.String },
  { name: 'email', type: Type.String },
  { name: 'tags', type: Type.ArrayString, optional: true },
])

// parseOne
const one = s.parseOne('users', Buffer.from(JSON.stringify({ id:1, name:'A', email:'a@x.com' })))
assertEq(one.id, 1, 'parseOne id')
assertEq(one.name, 'A', 'parseOne name')

// parse
const arr = s.parse('users', Buffer.from(JSON.stringify([{ id:2, name:'B', email:'b@x.com' }])))
assertEq(arr.length, 1, 'parse len')
assertEq(arr[0].name, 'B', 'parse name')

// parseString
const fromStr = s.parseString('users', JSON.stringify([{ id:3, name:'C', email:'c@x.com' }]))
assertEq(fromStr[0].id, 3, 'parseString id')

// validate
const v = s.validate('users', { id:4, name:'D', email:'d@x.com' })
assertEq(v.id, 4, 'validate id')

// validateObject
const vo = s.validateObject('users', { id:5, name:'E', email:'e@x.com', tags:['x'] })
assertEq(vo.id, 5, 'validateObject id')
assertEq(vo.name, 'E', 'validateObject name')

// Error cases
assertThrows(() => s.parseOne('users', Buffer.from(JSON.stringify({ name:'x' }))), 'missing required')
assertThrows(() => s.parseOne('users', Buffer.from(JSON.stringify({ id:'bad', name:'x', email:'x' }))), 'wrong type')
assertThrows(() => s.parse('x', Buffer.from('[]')), 'unknown schema')

// Duplicate field name
assertThrows(() => s.register('dup', [
  { name: 'a', type: Type.String },
  { name: 'a', type: Type.I64 },
]), 'duplicate field')

console.log(`\n${failed > 0 ? '❌' : '✅'} ${passed}/${passed + failed} tests passed`)
if (failed > 0) process.exit(1)
