import { join, resolve, parse } from 'node:path'

import * as colors from 'colorette'

import {
  applyDefaultArtifactsOptions,
  type ArtifactsOptions,
} from '../def/artifacts.js'
import {
  readNapiConfig,
  debugFactory,
  fileExists,
  readFileAsync,
  wasiLoaderSuffix,
  writeFileAsync,
  UniArchsByPlatform,
  readdirAsync,
} from '../utils/index.js'

const debug = debugFactory('artifacts')

export async function collectArtifacts(userOptions: ArtifactsOptions) {
  const options = applyDefaultArtifactsOptions(userOptions)

  const resolvePath = (...paths: string[]) => resolve(options.cwd, ...paths)
  const packageJsonPath = resolvePath(options.packageJsonPath)
  const { targets, binaryName, packageName } = await readNapiConfig(
    packageJsonPath,
    options.configPath ? resolvePath(options.configPath) : undefined,
  )

  const distDirs = targets.map((platform) =>
    join(options.cwd, options.npmDir, platform.platformArchABI),
  )

  const universalSourceBins = new Set(
    targets
      .filter((platform) => platform.arch === 'universal')
      .flatMap((p) =>
        UniArchsByPlatform[p.platform]?.map((a) => `${p.platform}-${a}`),
      )
      .filter(Boolean) as string[],
  )

  await collectNodeBinaries(join(options.cwd, options.outputDir)).then(
    (output) =>
      Promise.all(
        output.map(async (filePath) => {
          debug.info(`Read [${colors.yellowBright(filePath)}]`)
          const sourceContent = await readFileAsync(filePath)
          const parsedName = parse(filePath)
          const terms = parsedName.name.split('.')
          const platformArchABI = terms.pop()!
          const _binaryName = terms.join('.')

          if (_binaryName !== binaryName) {
            debug.warn(
              `[${_binaryName}] is not matched with [${binaryName}], skip`,
            )
            return
          }
          // Exact basename match: `wasm32-wasi` is a prefix of
          // `wasm32-wasip1`, so substring matching could bind an artifact to
          // the wrong flavor's dist dir.
          const dir = distDirs.find(
            (dir) => parse(dir).base === platformArchABI,
          )
          if (!dir && universalSourceBins.has(platformArchABI)) {
            debug.warn(
              `[${platformArchABI}] has no dist dir but it is source bin for universal arch, skip`,
            )
            return
          }
          if (!dir) {
            throw new Error(`No dist dir found for ${filePath}`)
          }

          const distFilePath = join(dir, parsedName.base)
          debug.info(
            `Write file content to [${colors.yellowBright(distFilePath)}]`,
          )
          await writeFileAsync(distFilePath, sourceContent)
          const distFilePathLocal = join(
            parse(packageJsonPath).dir,
            parsedName.base,
          )
          debug.info(
            `Write file content to [${colors.yellowBright(distFilePathLocal)}]`,
          )
          await writeFileAsync(distFilePathLocal, sourceContent)
        }),
      ),
  )

  // Collect the loader set of every declared WASI flavor into its own dist
  // dir. Two triples mapping to the same `platformArchABI` (e.g.
  // `wasm32-wasip1-threads` and `wasm32-wasi-preview1-threads`) describe the
  // same artifact set, so dedupe on it.
  const seenWasiFlavors = new Set<string>()
  for (const wasiTarget of targets.filter((t) => t.platform === 'wasi')) {
    if (seenWasiFlavors.has(wasiTarget.platformArchABI)) {
      continue
    }
    seenWasiFlavors.add(wasiTarget.platformArchABI)
    const hasThreads = wasiTarget.triple.endsWith('-threads')
    const loaderSuffix = wasiLoaderSuffix(wasiTarget.platformArchABI)
    const wasiDir = join(
      options.cwd,
      options.npmDir,
      wasiTarget.platformArchABI,
    )
    const cjsFile = join(
      options.buildOutputDir ?? options.cwd,
      `${binaryName}.${loaderSuffix}.cjs`,
    )
    const browserEntry = join(
      options.buildOutputDir ?? options.cwd,
      `${binaryName}.${loaderSuffix}-browser.js`,
    )
    debug.info(
      `Move wasi binding file [${colors.yellowBright(
        cjsFile,
      )}] to [${colors.yellowBright(wasiDir)}]`,
    )
    await writeFileAsync(
      join(wasiDir, `${binaryName}.${loaderSuffix}.cjs`),
      await readFileAsync(cjsFile),
    )
    debug.info(
      `Move wasi browser entry file [${colors.yellowBright(
        browserEntry,
      )}] to [${colors.yellowBright(wasiDir)}]`,
    )
    await writeFileAsync(
      join(wasiDir, `${binaryName}.${loaderSuffix}-browser.js`),
      // https://github.com/vitejs/vite/issues/8427
      (await readFileAsync(browserEntry, 'utf8')).replace(
        `new URL('./wasi-worker-browser.mjs', import.meta.url)`,
        `new URL('${packageName}-${wasiTarget.platformArchABI}/wasi-worker-browser.mjs', import.meta.url)`,
      ),
    )
    if (hasThreads) {
      // worker scripts are only emitted (and referenced) by threaded flavors
      const workerFile = join(
        options.buildOutputDir ?? options.cwd,
        `wasi-worker.mjs`,
      )
      const browserWorkerFile = join(
        options.buildOutputDir ?? options.cwd,
        `wasi-worker-browser.mjs`,
      )
      debug.info(
        `Move wasi worker file [${colors.yellowBright(
          workerFile,
        )}] to [${colors.yellowBright(wasiDir)}]`,
      )
      await writeFileAsync(
        join(wasiDir, `wasi-worker.mjs`),
        await readFileAsync(workerFile),
      )
      debug.info(
        `Move wasi browser worker file [${colors.yellowBright(
          browserWorkerFile,
        )}] to [${colors.yellowBright(wasiDir)}]`,
      )
      await writeFileAsync(
        join(wasiDir, `wasi-worker-browser.mjs`),
        await readFileAsync(browserWorkerFile),
      )
    } else {
      // The deferred workerd-safe loader is only emitted for non-threaded
      // WASI builds; tolerate its absence for artifact sets produced by an
      // older cli.
      const deferredEntry = join(
        options.buildOutputDir ?? options.cwd,
        `${binaryName}.${loaderSuffix}-deferred.js`,
      )
      if (await fileExists(deferredEntry)) {
        debug.info(
          `Move wasi deferred entry file [${colors.yellowBright(
            deferredEntry,
          )}] to [${colors.yellowBright(wasiDir)}]`,
        )
        await writeFileAsync(
          join(wasiDir, `${binaryName}.${loaderSuffix}-deferred.js`),
          await readFileAsync(deferredEntry),
        )
      }
    }
  }
}

async function collectNodeBinaries(root: string) {
  const files = await readdirAsync(root, { withFileTypes: true })
  const nodeBinaries = files
    .filter(
      (file) =>
        file.isFile() &&
        (file.name.endsWith('.node') || file.name.endsWith('.wasm')),
    )
    .map((file) => join(root, file.name))

  const dirs = files.filter((file) => file.isDirectory())
  for (const dir of dirs) {
    if (dir.name !== 'node_modules') {
      nodeBinaries.push(...(await collectNodeBinaries(join(root, dir.name))))
    }
  }
  return nodeBinaries
}
