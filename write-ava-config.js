const { writeFileSync } = require('fs')
const { join } = require('path')

const config = require('./ava.config.cjs')

const code = `
export default ${JSON.stringify(config, null, 2)}
`

writeFileSync(join(__dirname, 'ava.config.js'), code)
