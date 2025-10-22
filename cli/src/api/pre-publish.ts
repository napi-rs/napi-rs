import { execSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { Octokit } from '@octokit/rest'

import {
  applyDefaultPrePublishOptions,
  type PrePublishOptions,
} from '../def/pre-publish.js'
import {
  readFileAsync,
  readNapiConfig,
  debugFactory,
  updatePackageJson,
} from '../utils/index.js'

import { version } from './version.js'

const debug = debugFactory('pre-publish')

interface PackageInfo {
  name: string
  version: string
  tag: string
}

export async function prePublish(userOptions: PrePublishOptions) {
  debug('Receive pre-publish options:')
  debug('  %O', userOptions)

  const options = applyDefaultPrePublishOptions(userOptions)

  const packageJsonPath = resolve(options.cwd, options.packageJsonPath)

  const { packageJson, targets, packageName, binaryName, npmClient } =
    await readNapiConfig(
      packageJsonPath,
      options.configPath ? resolve(options.cwd, options.configPath) : undefined,
    )

  async function createGhRelease(packageName: string, version: string) {
    if (!options.ghRelease) {
      return {
        owner: null,
        repo: null,
        pkgInfo: { name: null, version: null, tag: null },
      }
    }
    const { repo, owner, pkgInfo, octokit } = getRepoInfo(packageName, version)

    if (!repo || !owner) {
      return {
        owner: null,
        repo: null,
        pkgInfo: { name: null, version: null, tag: null },
      }
    }

    if (!options.dryRun) {
      try {
        await octokit.repos.createRelease({
          owner,
          repo,
          tag_name: pkgInfo.tag,
          name: options.ghReleaseName,
          prerelease:
            version.includes('alpha') ||
            version.includes('beta') ||
            version.includes('rc'),
        })
      } catch (e) {
        debug(
          `Params: ${JSON.stringify(
            { owner, repo, tag_name: pkgInfo.tag },
            null,
            2,
          )}`,
        )
        console.error(e)
      }
    }
    return { owner, repo, pkgInfo, octokit }
  }

  function getRepoInfo(packageName: string, version: string) {
    const headCommit = execSync('git log -1 --pretty=%B', {
      encoding: 'utf-8',
    }).trim()

    const { GITHUB_REPOSITORY } = process.env
    if (!GITHUB_REPOSITORY) {
      return {
        owner: null,
        repo: null,
        pkgInfo: { name: null, version: null, tag: null },
      }
    }
    debug(`Github repository: ${GITHUB_REPOSITORY}`)
    const [owner, repo] = GITHUB_REPOSITORY.split('/')
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    })
    let pkgInfo: PackageInfo | undefined
    if (options.tagStyle === 'lerna') {
      const packagesToPublish = headCommit
        .split('\n')
        .map((line) => line.trim())
        .filter((line, index) => line.length && index)
        .map((line) => line.substring(2))
        .map(parseTag)

      pkgInfo = packagesToPublish.find(
        (pkgInfo) => pkgInfo.name === packageName,
      )

      if (!pkgInfo) {
        throw new TypeError(
          `No release commit found with ${packageName}, original commit info: ${headCommit}`,
        )
      }
    } else {
      pkgInfo = {
        tag: `v${version}`,
        version,
        name: packageName,
      }
    }
    return { owner, repo, pkgInfo, octokit }
  }

  if (!options.dryRun) {
    await version(userOptions)
    await updatePackageJson(packageJsonPath, {
      optionalDependencies: targets.reduce(
        (deps, target) => {
          deps[`${packageName}-${target.platformArchABI}`] = packageJson.version

          return deps
        },
        {} as Record<string, string>,
      ),
    })
  }

  const { owner, repo, pkgInfo, octokit } = options.ghReleaseId
    ? getRepoInfo(packageName, packageJson.version)
    : await createGhRelease(packageName, packageJson.version)

  for (const target of targets) {
    const pkgDir = resolve(
      options.cwd,
      options.npmDir,
      `${target.platformArchABI}`,
    )
    const ext =
      target.platform === 'wasi' || target.platform === 'wasm' ? 'wasm' : 'node'
    const filename = `${binaryName}.${target.platformArchABI}.${ext}`
    const dstPath = join(pkgDir, filename)

    if (!options.dryRun) {
      if (!existsSync(dstPath)) {
        debug.warn(`%s doesn't exist`, dstPath)
        continue
      }

      if (!options.skipOptionalPublish) {
        try {
          const output = execSync(`${npmClient} publish`, {
            cwd: pkgDir,
            env: process.env,
            stdio: 'pipe',
          })
          process.stdout.write(output)
        } catch (e) {
          if (
            e instanceof Error &&
            e.message.includes(
              'You cannot publish over the previously published versions',
            )
          ) {
            console.info(e.message)
            debug.warn(`${pkgDir} has been published, skipping`)
          } else {
            throw e
          }
        }
      }

      if (options.ghRelease && repo && owner) {
        debug.info(`Creating GitHub release ${pkgInfo.tag}`)
        try {
          const releaseId = options.ghReleaseId
            ? Number(options.ghReleaseId)
            : (
                await octokit!.repos.getReleaseByTag({
                  repo: repo,
                  owner: owner,
                  tag: pkgInfo.tag,
                })
              ).data.id
          const dstFileStats = statSync(dstPath)
          const assetInfo = await octokit!.repos.uploadReleaseAsset({
            owner: owner,
            repo: repo,
            name: filename,
            release_id: releaseId,
            mediaType: { format: 'raw' },
            headers: {
              'content-length': dstFileStats.size,
              'content-type': 'application/octet-stream',
            },
            // @ts-expect-error octokit types are wrong
            data: await readFileAsync(dstPath),
          })
          debug.info(`GitHub release created`)
          debug.info(`Download URL: %s`, assetInfo.data.browser_download_url)
        } catch (e) {
          debug.error(
            `Param: ${JSON.stringify(
              { owner, repo, tag: pkgInfo.tag, filename: dstPath },
              null,
              2,
            )}`,
          )
          debug.error(e)
        }
      }
    }
  }
}

function parseTag(tag: string) {
  const segments = tag.split('@')
  const version = segments.pop()!
  const name = segments.join('@')

  return {
    name,
    version,
    tag,
  }
}
