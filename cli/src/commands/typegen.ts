import { typegenProject } from '../api/typegen.js'
import { BaseTypegenCommand } from '../def/typegen.js'

export class TypegenCommand extends BaseTypegenCommand {
  async execute() {
    const dtsFile = await typegenProject(this.getOptions())
    this.context.stdout.write(`Generated type definitions: ${dtsFile}\n`)
  }
}
