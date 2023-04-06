import { createNpmDirs } from '../api/create-npm-dirs.js'
import { BaseCreateNpmDirsCommand } from '../def/create-npm-dirs.js'

export class CreateNpmDirsCommand extends BaseCreateNpmDirsCommand {
  async execute() {
    await createNpmDirs(this.getOptions())
  }
}
