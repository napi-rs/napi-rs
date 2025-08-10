import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { kebabCase, startCase } from 'es-toolkit'

import { commandDefines, CommandSchema, OptionSchema } from './commands.js'

const __filename = fileURLToPath(import.meta.url)
const defFolder = path.join(__filename, '../../src/def')
const docsTargetFolder = path.join(__filename, '../../docs')

function PascalCase(str: string) {
  return startCase(str).replace(/\s/g, '')
}

/**
 * convert command definition to command options interface
 */
function generateOptionsDef(command: CommandSchema) {
  const optionsName = `${PascalCase(command.name)}Options`

  const optLines: string[] = []

  optLines.push('/**')
  optLines.push(` * ${command.description}`)
  optLines.push(' */')
  optLines.push(`export interface ${optionsName} {`)
  command.args.forEach((arg) => {
    optLines.push('  /**')
    optLines.push(`   * ${arg.description}`)
    optLines.push('   */')
    optLines.push(`  ${arg.name}${arg.required ? '' : '?'}: ${arg.type}`)
  })

  command.options.forEach((opt) => {
    optLines.push('  /**')
    optLines.push(`   * ${opt.description}`)
    if (typeof opt.default !== 'undefined') {
      optLines.push('   *')
      optLines.push(`   * @default ${opt.default}`)
    }
    optLines.push('   */')
    optLines.push(`  ${opt.name}${opt.required ? '' : '?'}: ${opt.type}`)
  })

  optLines.push('}\n')

  if (command.options.some((opt) => typeof opt.default !== 'undefined')) {
    optLines.push(
      `export function applyDefault${optionsName}(options: ${optionsName}) {`,
    )
    optLines.push(`  return {`)
    command.options.forEach((opt) => {
      if (typeof opt.default !== 'undefined') {
        optLines.push(`    ${opt.name}: ${opt.default},`)
      }
    })
    optLines.push('    ...options,')
    optLines.push('  }')
    optLines.push('}\n')
  }

  return optLines.join('\n')
}

function getOptionDescriptor(opt: OptionSchema) {
  let desc = `--${opt.long ?? kebabCase(opt.name)}`
  if (opt.alias) {
    desc += `,${opt.alias.map((alias) => `--${alias}`).join(',')}`
  }
  if (opt.short) {
    desc += `,${opt.short.map((short) => `-${short}`).join(',')}`
  }

  return desc
}

function generateCommandDef(command: CommandSchema) {
  const commandPath = kebabCase(command.name)
  const avoidList = ['path', 'name']

  const avoidName = (name: string) => {
    return avoidList.includes(name) ? '$$' + name : name
  }

  const prepare: string[] = []
  const cmdLines: string[] = []

  let paths = `[['${commandPath}']]`

  if (command.alias) {
    command.alias.unshift(commandPath)
    paths = `[${command.alias.map((alias) => `['${alias}']`).join(', ')}]`
  }

  cmdLines.push(`
export abstract class Base${PascalCase(command.name)}Command extends Command {
  static paths = ${paths}

  static usage = Command.Usage({
    description: '${command.description}',
  })\n`)

  command.args.forEach((arg) => {
    cmdLines.push(
      `  ${avoidName(arg.name)} = Option.String({ required: ${
        arg.required ?? false
      } })`,
    )
  })

  cmdLines.push('')

  command.options.forEach((opt) => {
    const optName = avoidName(opt.name)
    let optionType = ''

    switch (opt.type) {
      case 'number':
        optionType = 'String'
        prepare.push("import * as typanion from 'typanion'")
        break
      case 'boolean':
        optionType = 'Boolean'
        break
      case 'string[]':
        optionType = 'Array'
        break
      case 'string':
      default:
        optionType = 'String'
    }

    const optionDesc = getOptionDescriptor(opt)

    if (opt.required) {
      cmdLines.push(`  ${optName} = Option.${optionType}('${optionDesc}', {`)
      cmdLines.push('    required: true,')
    } else if (typeof opt.default !== 'undefined') {
      const defaultValue =
        typeof opt.default === 'number'
          ? `'${opt.default.toString()}'`
          : opt.default
      cmdLines.push(`  ${optName} = Option.${optionType}(`)
      cmdLines.push(`    '${optionDesc}',`)
      cmdLines.push(`    ${defaultValue},`)
      cmdLines.push(`    {`)
    } else {
      cmdLines.push(
        `  ${optName}?: ${opt.type} = Option.${optionType}('${optionDesc}', {`,
      )
    }

    if (opt.type === 'number') {
      cmdLines.push('    validator: typanion.isNumber(),')
    }

    cmdLines.push(`    description: '${opt.description}'`)
    cmdLines.push('  })\n')
  })

  cmdLines.push(`  getOptions() {`)
  cmdLines.push(`    return {`)
  command.args
    .map(({ name }) => name)
    .concat(command.options.map(({ name }) => name))
    .forEach((name) => {
      cmdLines.push(`      ${name}: this.${avoidName(name)},`)
    })
  cmdLines.push('    }')
  cmdLines.push('  }')

  cmdLines.push('}\n')

  return prepare.join('\n') + '\n' + cmdLines.join('\n')
}

function generateDocs(command: CommandSchema, targetFolder: string): string {
  const docsFileName = kebabCase(command.name)
  const docsFile = path.join(targetFolder, `${docsFileName}.md`)

  const options: string[] = []

  command.args.forEach((arg) => {
    options.push(
      [
        '',
        arg.name,
        `<${kebabCase(arg.name)}>`,
        arg.required ? 'true' : 'false',
        arg.type,
        '',
        arg.description,
        '',
      ].join('|'),
    )
  })

  command.options.forEach((opt) => {
    options.push(
      [
        '',
        opt.name,
        getOptionDescriptor(opt),
        opt.type.replace(/\|/g, '\\|'),
        opt.required ? 'true' : 'false',
        opt.default ?? '',
        opt.description,
        '',
      ].join('|'),
    )
  })

  const content = `# ${startCase(command.name)}

> This file is generated by cli/codegen. Do not edit this file manually.

${command.description}

## Usage

\`\`\`sh
# CLI
napi ${kebabCase(command.name)}${command.args.reduce(
    (h, arg) => h + ` <${arg.name}>`,
    '',
  )} [--options]
\`\`\`

\`\`\`typescript
// Programatically
import { NapiCli } from '@napi-rs/cli'

new NapiCli().${command.name}({
  // options
})
\`\`\`

## Options

| Options | CLI Options | type | required | default | description |
| ------- | ----------- | ---- | -------- | ------- | ----------- |
|         | --help,-h   |      |          |         | get help    |
${options.join('\n')}
`

  // make sure the target folder exists
  fs.mkdirSync(targetFolder, { recursive: true })
  // write file
  fs.writeFileSync(docsFile, content)

  return docsFile
}

function generateDef(cmd: CommandSchema, folder: string): string {
  const defFileName = kebabCase(cmd.name)
  const defFilePath = path.join(folder, `${defFileName}.ts`)

  const def = `// This file is generated by codegen/index.ts
// Do not edit this file manually
import { Command, Option } from 'clipanion'
${generateCommandDef(cmd)}

${generateOptionsDef(cmd)}
`

  // make sure the target folder exists
  fs.mkdirSync(folder, { recursive: true })
  // write file
  fs.writeFileSync(defFilePath, def)

  return defFilePath
}

function codegen() {
  const outputs: string[] = []
  commandDefines.forEach((command) => {
    outputs.push(generateDef(command, defFolder))
    outputs.push(generateDocs(command, docsTargetFolder))
  })

  outputs.forEach((output) => {
    execSync(`yarn prettier -w ${output}`)
  })
}

codegen()
