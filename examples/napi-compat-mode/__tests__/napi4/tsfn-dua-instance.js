const bindings = require('../../index.node')

async function main() {
  await Promise.resolve()
  const a1 = new bindings.A((err, s) => {
    console.info(s)
  })
  const a2 = new bindings.A((err, s) => {
    console.info(s)
  })
  a1.call()
  a2.call()
}

main().catch((e) => {
  console.error(e)
})
