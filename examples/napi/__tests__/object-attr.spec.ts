import ava from 'ava'

const { NotWritableClass } = (await import('../index.js')).default

const test = process.env.WASI_TEST ? ava.skip : ava

test('Not Writable Class', (t) => {
  const obj = new NotWritableClass('1')
  t.throws(() => {
    obj.name = '2'
  })
  obj.setName('2')
  t.is(obj.name, '2')
  t.throws(() => {
    obj.setName = () => {}
  })
})
