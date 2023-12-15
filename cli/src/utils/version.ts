export enum NapiVersion {
  Napi1 = 1,
  Napi2,
  Napi3,
  Napi4,
  Napi5,
  Napi6,
  Napi7,
  Napi8,
  Napi9,
}

/// because node support new napi version in some minor version updates, so we might meet such situation:
/// `node v10.20.0` supports `napi5` and `napi6`, but `node v12.0.0` only support `napi4`,
/// by which, we can not tell directly napi version supportless from node version directly.
const NAPI_VERSION_MATRIX = new Map<NapiVersion, string>([
  [NapiVersion.Napi1, '8.6.0 | 9.0.0 | 10.0.0'],
  [NapiVersion.Napi2, '8.10.0 | 9.3.0 | 10.0.0'],
  [NapiVersion.Napi3, '6.14.2 | 8.11.2 | 9.11.0 | 10.0.0'],
  [NapiVersion.Napi4, '10.16.0 | 11.8.0 | 12.0.0'],
  [NapiVersion.Napi5, '10.17.0 | 12.11.0 | 13.0.0'],
  [NapiVersion.Napi6, '10.20.0 | 12.17.0 | 14.0.0'],
  [NapiVersion.Napi7, '10.23.0 | 12.19.0 | 14.12.0 | 15.0.0'],
  [NapiVersion.Napi8, '12.22.0 | 14.17.0 | 15.12.0 | 16.0.0'],
  [NapiVersion.Napi9, '18.17.0 | 20.3.0 | 21.1.0'],
])

interface NodeVersion {
  major: number
  minor: number
  patch: number
}

function parseNodeVersion(v: string): NodeVersion {
  const matches = v.match(/v?([0-9]+)\.([0-9]+)\.([0-9]+)/i)

  if (!matches) {
    throw new Error('Unknown node version number: ' + v)
  }

  const [, major, minor, patch] = matches

  return {
    major: parseInt(major),
    minor: parseInt(minor),
    patch: parseInt(patch),
  }
}

function requiredNodeVersions(napiVersion: NapiVersion): NodeVersion[] {
  const requirement = NAPI_VERSION_MATRIX.get(napiVersion)

  if (!requirement) {
    return [parseNodeVersion('10.0.0')]
  }

  return requirement.split('|').map(parseNodeVersion)
}

function toEngineRequirement(versions: NodeVersion[]): string {
  const requirements: string[] = []
  versions.forEach((v, i) => {
    let req = ''
    if (i !== 0) {
      const lastVersion = versions[i - 1]
      req += `< ${lastVersion.major + 1}`
    }

    req += `${i === 0 ? '' : ' || '}>= ${v.major}.${v.minor}.${v.patch}`
    requirements.push(req)
  })

  return requirements.join(' ')
}

export function napiEngineRequirement(napiVersion: NapiVersion): string {
  return toEngineRequirement(requiredNodeVersions(napiVersion))
}
