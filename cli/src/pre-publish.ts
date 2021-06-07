import { join } from 'path'

import { Octokit } from '@octokit/rest'
import chalk from 'chalk'
import { Command } from 'clipanion'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { spawn } from './spawn'
import { updatePackageJson } from './update-package'
import { existsAsync } from './utils'
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

  @Command.String(`-p,--prefix`)
  prefix = 'npm'

  @Command.String('--tagstyle,-t')
  tagStyle: 'npm' | 'lerna' = 'lerna'

  @Command.String('-c,--config')
  configFileName?: string

  @Command.Boolean('--dry-run')
  isDryRun = false

  @Command.Boolean('--skip-gh-release')
  skipGHRelease = false

  @Command.Path('prepublish')
  async execute() {
    const { packageJsonPath, platforms, version, packageName, binaryName } =
      getNapiConfig(this.configFileName)
    debug(`Update optionalDependencies in [${packageJsonPath}]`)
    if (!this.isDryRun) {
      await VersionCommand.updatePackageJson(this.prefix, this.configFileName)
      await updatePackageJson(packageJsonPath, {
        optionalDependencies: platforms.reduce(
          (acc: Record<string, string>, cur) => {
            acc[`${packageName}-${cur.platformArchABI}`] = `^${version}`
            return acc
          },
          {},
        ),
      })
    }

    const { owner, repo, pkgInfo } = await this.createGhRelease(
      packageName,
      version,
    )

    for (const platformDetail of platforms) {
      const pkgDir = join(
        process.cwd(),
        this.prefix,
        `${platformDetail.platformArchABI}`,
      )
      const filename = `${binaryName}.${platformDetail.platformArchABI}.node`
      const dstPath = join(pkgDir, filename)

      if (!this.isDryRun) {
        if (!(await existsAsync(dstPath))) {
          console.warn(`[${chalk.yellowBright(dstPath)}] is not existed`)
          continue
        }
        await spawn('npm publish', {
          cwd: pkgDir,
          env: process.env,
        })
        if (!this.skipGHRelease) {
          debug(
            `Start upload [${chalk.greenBright(
              dstPath,
            )}] to Github release, [${chalk.greenBright(pkgInfo.tag)}]`,
          )
          const putasset = require('putasset')
          try {
            const downloadUrl = await putasset(process.env.GITHUB_TOKEN, {
              owner,
              repo,
              tag: pkgInfo.tag,
              filename: dstPath,
            })
            console.info(`${chalk.green(dstPath)} upload success`)
            console.info(`Download url: ${chalk.blueBright(downloadUrl)}`)
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
    const headCommit = (await spawn('git log -1 --pretty=%B'))
      .toString('utf8')
      .trim()

    debug(`Github repository: ${process.env.GITHUB_REPOSITORY}`)
    const [owner, repo] = process.env.GITHUB_REPOSITORY!.split('/')
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    })
    let pkgInfo: PackageInfo | undefined
    if (this.tagStyle === 'lerna') {
      const packagesToPublish = headCommit
        .split('\n')
        .map((line) => line.trim())
        .filter((line, index) => line.length && index)
        .map((line) => line.substr(2))
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
    if (!this.isDryRun) {
      try {
        await octokit.repos.createRelease({
          owner,
          repo,
          tag_name: pkgInfo.tag,
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
    return { owner, repo, pkgInfo }
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
