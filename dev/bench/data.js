window.BENCHMARK_DATA = {
  lastUpdate: 1616123470134,
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
          id: '2ae748249d65579ad73b2b257b6d5a8931c1d1fa',
          message:
            'Merge pull request #508 from getditto/ditto/closure-into-jsfunction\n\nAdd a way to convert stateful (Rust) closures into `JsFunction`s.',
          timestamp: '2021-03-19T11:07:15+08:00',
          tree_id: 'd8a7f7e46a813e7cfa066f0e59d9905b37196632',
          url:
            'https://github.com/napi-rs/napi-rs/commit/2ae748249d65579ad73b2b257b6d5a8931c1d1fa',
        },
        date: 1616123468094,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 49538953,
            range: '±1.72%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 831127738,
            range: '±1.31%',
            unit: 'ops/sec',
            extra: '87 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 20088171,
            range: '±1.98%',
            unit: 'ops/sec',
            extra: '82 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 825377354,
            range: '±1.63%',
            unit: 'ops/sec',
            extra: '85 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 60722,
            range: '±24.24%',
            unit: 'ops/sec',
            extra: '62 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 72236,
            range: '±46.13%',
            unit: 'ops/sec',
            extra: '77 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 428849,
            range: '±3.54%',
            unit: 'ops/sec',
            extra: '76 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 362185,
            range: '±3.44%',
            unit: 'ops/sec',
            extra: '75 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 282349,
            range: '±51.86%',
            unit: 'ops/sec',
            extra: '58 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 342951,
            range: '±3.24%',
            unit: 'ops/sec',
            extra: '76 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 29268,
            range: '±2.15%',
            unit: 'ops/sec',
            extra: '78 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 10419,
            range: '±8.96%',
            unit: 'ops/sec',
            extra: '74 samples',
          },
        ],
      },
    ],
  },
}
