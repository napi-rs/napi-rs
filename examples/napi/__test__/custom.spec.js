const { callThreadsafeFunction, asyncPlus100 } = require('../index')

// ;(async () => {
//   let res = await asyncPlus100(Promise.resolve(1))
//   console.log(res)
// })()


console.log("[js] enter js test")
callThreadsafeFunction(async (err, value) => {
  // console.log(err, value)
  console.log("[js] entered the js side")
  console.log("[js] err", err)
  console.log("[js] value", value, typeof value)
  return 12
})
