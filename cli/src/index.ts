import { collectArtifacts } from './api/artifacts.js'
import { buildProject } from './api/build.js'
import { createNpmDirs } from './api/create-npm-dirs.js'
import { newProject } from './api/new.js'
import { prePublish } from './api/pre-publish.js'
import { renameProject } from './api/rename.js'
import { universalizeBinaries } from './api/universalize.js'
import { version } from './api/version.js'

/**
 *
 * @usage
 *
 * ```ts
 * const cli = new NapiCli()
 *
 * cli.build({
 *   cwd: '/path/to/your/project',
 * })
 * ```
 */
export class NapiCli {
  artifacts = collectArtifacts
  new = newProject
  build = buildProject
  createNpmDirs = createNpmDirs
  prePublish = prePublish
  rename = renameProject
  universalize = universalizeBinaries
  version = version
}

export { parseTriple } from './utils/target.js'
