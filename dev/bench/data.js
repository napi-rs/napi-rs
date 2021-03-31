window.BENCHMARK_DATA = {
  lastUpdate: 1617198157070,
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
          id: 'd83fab23cd9806ced347026fef4fc3fe2c3e8bab',
          message:
            'Merge pull request #521 from messense/multiarch\n\nBuild multiarch Docker images',
          timestamp: '2021-03-31T21:37:18+08:00',
          tree_id: '39ac18674cf505995d6f96d6dadd3c42f5a3bdee',
          url:
            'https://github.com/napi-rs/napi-rs/commit/d83fab23cd9806ced347026fef4fc3fe2c3e8bab',
        },
        date: 1617198155692,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 56971634,
            range: '±1.07%',
            unit: 'ops/sec',
            extra: '95 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 813221195,
            range: '±0.1%',
            unit: 'ops/sec',
            extra: '97 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 19476772,
            range: '±0.35%',
            unit: 'ops/sec',
            extra: '98 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 810985799,
            range: '±0.14%',
            unit: 'ops/sec',
            extra: '93 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 86248,
            range: '±40.51%',
            unit: 'ops/sec',
            extra: '60 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 64521,
            range: '±60.1%',
            unit: 'ops/sec',
            extra: '61 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 403812,
            range: '±31.02%',
            unit: 'ops/sec',
            extra: '74 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 366573,
            range: '±22.52%',
            unit: 'ops/sec',
            extra: '76 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 413789,
            range: '±1.23%',
            unit: 'ops/sec',
            extra: '85 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 384795,
            range: '±1.58%',
            unit: 'ops/sec',
            extra: '89 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 36328,
            range: '±1.19%',
            unit: 'ops/sec',
            extra: '87 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 14376,
            range: '±9.35%',
            unit: 'ops/sec',
            extra: '77 samples',
          },
        ],
      },
    ],
  },
}
