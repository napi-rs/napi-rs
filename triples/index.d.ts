interface Triple {
  platform: string
  arch: string
  abi: string | null
  platformArchABI: string
  raw: string
}

declare const Triples: Triple[] & {
  platformArchTriples: {
    [index: string]: {
      [index: string]: Triple[]
    }
  }
}

export = Triples
