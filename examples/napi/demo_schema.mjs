import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const napi = require('./index.cjs')

// Enum mirroring #[napi(string_enum)] pub enum FieldType — zero magic strings
const Type = {
  String: 'string',
  I64: 'i64',
  F64: 'f64',
  Bool: 'bool',
  Json: 'json',
  ArrayString: 'array:string',
  ArrayI64: 'array:i64',
  ArrayF64: 'array:f64',
}

const schema = new napi.DynamicSchema()

schema.register('users', [
  { name: 'id', type: Type.I64, optional: false },
  { name: 'name', type: Type.String },
  { name: 'email', type: Type.String },
  { name: 'score', type: Type.F64, optional: true },
  { name: 'tags', type: Type.ArrayString, optional: true },
])

schema.register('orders', [
  { name: 'orderId', type: Type.I64 },
  { name: 'userId', type: Type.I64 },
  { name: 'total', type: Type.F64 },
  { name: 'status', type: Type.String },
  { name: 'items', type: Type.ArrayString, optional: true },
])

schema.register('metrics', [
  { name: 'host', type: Type.String },
  { name: 'cpu', type: Type.F64 },
  { name: 'mem', type: Type.F64 },
  { name: 'timestamp', type: Type.I64 },
])

console.log('Registered schemas: users, orders, metrics\n')

// --- Parse & Validate Demo ---

const singleUser = Buffer.from(JSON.stringify({
  id: 1, name: 'Alice', email: 'alice@example.com', score: 99.5, tags: ['admin', 'dev'],
}))
const parsed = schema.parseOne('users', singleUser)
console.log('Single user:', JSON.stringify(parsed))

const usersData = Buffer.from(JSON.stringify([
  { id: 1, name: 'Alice', email: 'alice@x.com', score: 100, tags: ['admin'] },
  { id: 2, name: 'Bob', email: 'bob@x.com', tags: ['user'] },
]))
const users = schema.parse('users', usersData)
console.log(`Parsed ${users.length} users`)

const order = { orderId: 42, userId: 7, total: 299.99, status: 'shipped' }
const validated = schema.validate('orders', order)
console.log('Validated order:', JSON.stringify(validated))

// Error cases
try { schema.validate('users', { name: 'NoID' }) }
catch (e) { console.log('Caught: missing required field →', e.message) }

try { schema.validate('users', { id: 'bad', name: 'x', email: 'x@x' }) }
catch (e) { console.log('Caught: wrong type →', e.message) }

try { schema.parse('unknown', Buffer.from('[]')) }
catch (e) { console.log('Caught: unknown schema →', e.message) }

console.log()
