import test from 'ava'

test('async napi functions let the process exit', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  const { fetch } = await import('../index.cjs')
  const response = await fetch('https://httpbin.org/delay/1')
  const json = (await response.json()) as { url: string }
  t.is(json.url, 'https://httpbin.org/delay/1')
})
