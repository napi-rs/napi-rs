const { whiteBright, red, green, gray } = require('colorette')
const prettyBytes = require('pretty-bytes')
const { table } = require('table')

module.exports = function displayMemoryUsageFromNode(initialMemoryUsage) {
  const finalMemoryUsage = process.memoryUsage()
  const titles = Object.keys(initialMemoryUsage).map((k) => whiteBright(k))
  const tableData = [titles]
  const diffColumn = []
  for (const [key, value] of Object.entries(initialMemoryUsage)) {
    const diff = finalMemoryUsage[key] - value
    const prettyDiff = prettyBytes(diff, { signed: true })
    if (diff > 0) {
      diffColumn.push(red(prettyDiff))
    } else if (diff < 0) {
      diffColumn.push(green(prettyDiff))
    } else {
      diffColumn.push(gray(prettyDiff))
    }
  }
  tableData.push(diffColumn)
  console.info(table(tableData))
}
