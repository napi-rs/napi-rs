const { callThreadsafeFunction } = require('../index')

console.log("[js] enter js test")
callThreadsafeFunction((err, value) => {
  // console.log(err, value)
  console.log("[js] entered the js side")
  console.log("[js] err", err)
  console.log("[js] value", value)
  return 123
})

process.on("uncaughtException", console.log)
process.on("unhandledRejection", console.log)
