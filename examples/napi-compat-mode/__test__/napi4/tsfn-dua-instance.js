const bindings = require('../../index.node')

async function main() {
  await Promise.resolve()
  new bindings.A((s) => console.info(s))
  new bindings.A((s) => console.info(s))
}

main().catch((e) => {
  console.error(e)
})
