const { execSync } = require('node:child_process')

const commitMessage = execSync('git log -1 --pretty=%B', {
  encoding: 'utf8',
}).toString()

const [_, ...body] = commitMessage
  .trim()
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const packagesToBump = body.map((line) => {
  const pkgNameVersion = line.split('@')
  pkgNameVersion.pop()
  const pkgName = pkgNameVersion.join('@')
  return pkgName.substring(2)
})

for (const pkg of packagesToBump) {
  execSync(`yarn workspace ${pkg} exec "npm publish"`, {
    stdio: 'inherit',
    env: process.env,
  })
}
