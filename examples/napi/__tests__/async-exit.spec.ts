import test from 'ava'

test('async napi functions let the process exit', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  const { fetch } = await import('../index.cjs')
  const response = await fetch('https://api.github.com/repos/napi-rs/napi-rs', {
    headers: {
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/json',
      'User-Agent': 'napi-rs/napi-rs',
    },
  })
  const json = (await response.json()) as { full_name: string }
  t.is(json.full_name, 'napi-rs/napi-rs')
})
