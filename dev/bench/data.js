window.BENCHMARK_DATA = {
  lastUpdate: 1617281319587,
  repoUrl: 'https://github.com/napi-rs/napi-rs',
  entries: {
    Benchmark: [
      {
        commit: {
          author: {
            email: 'lynweklm@gmail.com',
            name: 'LongYinan',
            username: 'Brooooooklyn',
          },
          committer: {
            email: 'noreply@github.com',
            name: 'GitHub',
            username: 'web-flow',
          },
          distinct: true,
          id: '9d76a39aa5da62e63f9193b19d2ba9e98ae9f0e3',
          message:
            'Merge pull request #524 from napi-rs/split-napi-raw\n\nrefactor(napi): split NapiRaw trait from NapiValue',
          timestamp: '2021-04-01T20:44:40+08:00',
          tree_id: '69da55981087edaef58f731d3a9209012a185744',
          url:
            'https://github.com/napi-rs/napi-rs/commit/9d76a39aa5da62e63f9193b19d2ba9e98ae9f0e3',
        },
        date: 1617281318055,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 43708407,
            range: '±0.79%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 728170984,
            range: '±0.59%',
            unit: 'ops/sec',
            extra: '87 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 16738771,
            range: '±0.65%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 723372553,
            range: '±0.72%',
            unit: 'ops/sec',
            extra: '89 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 56679,
            range: '±39.55%',
            unit: 'ops/sec',
            extra: '68 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 46253,
            range: '±102.12%',
            unit: 'ops/sec',
            extra: '82 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 385426,
            range: '±3.16%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 344944,
            range: '±2.96%',
            unit: 'ops/sec',
            extra: '79 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 356094,
            range: '±2.92%',
            unit: 'ops/sec',
            extra: '79 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 326378,
            range: '±3.25%',
            unit: 'ops/sec',
            extra: '83 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 24893,
            range: '±1.4%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 8085,
            range: '±13.67%',
            unit: 'ops/sec',
            extra: '71 samples',
          },
        ],
      },
    ],
  },
}
