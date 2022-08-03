import { createReadStream, existsSync, statSync } from 'fs'
import { join } from 'path'

import { Octokit } from '@octokit/rest'
import chalk from 'chalk'
import { Command, Option } from 'clipanion'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { spawn } from './spawn'
import { updatePackageJson } from './update-package'
import { VersionCommand } from './version'

const debug = debugFactory('prepublish')

interface PackageInfo {
  name: string
  version: string
  tag: string
}

export class PrePublishCommand extends Command {
  static usage = Command.Usage({
    description:
      'Update package.json and copy addons into per platform packages',
  })

  static paths = [['prepublish']]

  prefix = Option.String(`-p,--prefix`, 'npm')

  tagStyle: 'npm' | 'lerna' = Option.String('--tagstyle,-t', 'lerna')

  configFileName?: string = Option.String('-c,--config')

  isDryRun = Option.Boolean('--dry-run', false)

  skipGHRelease = Option.Boolean('--skip-gh-release', false)

  ghReleaseName?: string = Option.String('--gh-release-name')

  existingReleaseId?: string = Option.String('--gh-release-id')

  async execute() {
    const {
      packageJsonPath,
      platforms,
      version,
      packageName,
      binaryName,
      npmClient,
    } = getNapiConfig(this.configFileName)
    debug(`Update optionalDependencies in [${packageJsonPath}]`)
    if (!this.isDryRun) {
      await VersionCommand.updatePackageJson(this.prefix, this.configFileName)
      await updatePackageJson(packageJsonPath, {
        optionalDependencies: platforms.reduce(
          (acc: Record<string, string>, cur) => {
            acc[`${packageName}-${cur.platformArchABI}`] = `${version}`
            return acc
          },
          {},
        ),
      })
    }

    const { owner, repo, pkgInfo, octokit } = this.existingReleaseId
      ? await this.getRepoInfo(packageName, version)
      : await this.createGhRelease(packageName, version)

    for (const platformDetail of platforms) {
      const pkgDir = join(
        process.cwd(),
        this.prefix,
        `${platformDetail.platformArchABI}`,
      )
      const filename = `${binaryName}.${platformDetail.platformArchABI}.node`
      const dstPath = join(pkgDir, filename)

      if (!this.isDryRun) {
        if (!existsSync(dstPath)) {
          console.warn(`[${chalk.yellowBright(dstPath)}] doesn't exist`)
          continue
        }
        await spawn(`${npmClient} publish`, {
          cwd: pkgDir,
          env: process.env,
        })
        if (!this.skipGHRelease && repo && owner) {
          debug(
            `Start upload [${chalk.greenBright(
              dstPath,
            )}] to Github release, [${chalk.greenBright(pkgInfo.tag)}]`,
          )
          try {
            const releaseId = this.existingReleaseId
              ? Number(this.existingReleaseId)
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
              // @ts-expect-error
              data: createReadStream(dstPath),
            })
            console.info(`${chalk.green(dstPath)} upload success`)
            console.info(
              `Download url: ${chalk.blueBright(
                assetInfo.data.browser_download_url,
              )}`,
            )
          } catch (e) {
            debug(
              `Param: ${JSON.stringify(
                { owner, repo, tag: pkgInfo.tag, filename: dstPath },
                null,
                2,
              )}`,
            )
            console.error(e)
          }
        }
      }
    }
  }

  private async createGhRelease(packageName: string, version: string) {
    if (this.skipGHRelease) {
      return {
        owner: null,
        repo: null,
        pkgInfo: { name: null, version: null, tag: null },
      }
    }
    const { repo, owner, pkgInfo, octokit } = await this.getRepoInfo(
      packageName,
      version,
    )

    if (!repo || !owner) {
      return {
        owner: null,
        repo: null,
        pkgInfo: { name: null, version: null, tag: null },
      }
    }

    if (!this.isDryRun) {
      try {
        await octokit.repos.createRelease({
          owner,
          repo,
          tag_name: pkgInfo.tag,
          name: this.ghReleaseName,
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

  private async getRepoInfo(packageName: string, version: string) {
    const headCommit = (await spawn('git log -1 --pretty=%B'))
      .toString('utf8')
      .trim()
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
    if (this.tagStyle === 'lerna') {
      const packagesToPublish = headCommit
        .split('\n')
        .map((line) => line.trim())
        .filter((line, index) => line.length && index)
        .map((line) => line.substring(2))
        .map(this.parseTag)
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

  private parseTag(tag: string) {
    const segments = tag.split('@')
    const version = segments.pop()!
    const name = segments.join('@')

    return {
      name,
      version,
      tag,
    }
  }
}
