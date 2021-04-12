window.BENCHMARK_DATA = {
  lastUpdate: 1618224098987,
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
          id: '3be8136a7aff8b9c4e4aa6015110a24be24ada30',
          message:
            'Merge pull request #532 from napi-rs/tsfn-memory-ordering\n\nfix(napi): memory ordering issues in tsfn',
          timestamp: '2021-04-12T18:37:34+08:00',
          tree_id: '00e836ab92e60fc8f3efb2e0f33f570d0edd39d5',
          url:
            'https://github.com/napi-rs/napi-rs/commit/3be8136a7aff8b9c4e4aa6015110a24be24ada30',
        },
        date: 1618224097518,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 45818290,
            range: '±1.3%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 587945565,
            range: '±1.11%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 14041825,
            range: '±1.14%',
            unit: 'ops/sec',
            extra: '89 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 584651187,
            range: '±1.02%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 84240,
            range: '±21.92%',
            unit: 'ops/sec',
            extra: '75 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 51508,
            range: '±60.41%',
            unit: 'ops/sec',
            extra: '55 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 415116,
            range: '±3.05%',
            unit: 'ops/sec',
            extra: '83 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 359015,
            range: '±3.17%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 360139,
            range: '±3.22%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 335267,
            range: '±3.56%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 26780,
            range: '±3.52%',
            unit: 'ops/sec',
            extra: '77 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 1296,
            range: '±175.39%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
        ],
      },
    ],
  },
}
