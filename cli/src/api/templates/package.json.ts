export const createPackageJson = ({
  name,
  binaryName,
  targets,
  license,
  engineRequirement,
  cliVersion,
}: {
  name: string
  binaryName: string
  targets: string[]
  license: string
  engineRequirement: string
  cliVersion: string
}) => {
  return `{
  "name": "${name}",
  "version": "1.0.0",
  "main": "index.js",
  "types": "index.d.ts",
  "license": "${license}",
  "engines": {
    "node": "${engineRequirement}"
  },
  "napi": {
    "name": "${binaryName}",
    "targets": [
      ${targets.map((t) => `"${t}"`).join(',\n      ')}
    ]
  },
  "scripts": {
    "test": "yarn build:debug --platform && node -e \\"assert(require('.').sum(1, 2) === 3)\\"",
    "build": "napi build --release --platform --strip",
    "build:debug": "napi build",
    "prepublishOnly": "napi prepublish -t npm",
    "artifacts": "napi artifacts",
    "universal": "napi universal",
    "version": "napi version"
  },
  "devDependencies": {
    "@napi-rs/cli": "^${cliVersion}"
  }
}`
}
