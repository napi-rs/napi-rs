window.BENCHMARK_DATA = {
  lastUpdate: 1616127596290,
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
          id: '645584cfa9f7fa5377f29bdd9af2ddbd64225261',
          message:
            'Merge pull request #509 from napi-rs/upgrade-musl-image\n\nci: use lts alpine image',
          timestamp: '2021-03-19T12:15:31+08:00',
          tree_id: '8cff71a549a70d2aa80d2b753eb6b3a92a5b65b7',
          url:
            'https://github.com/napi-rs/napi-rs/commit/645584cfa9f7fa5377f29bdd9af2ddbd64225261',
        },
        date: 1616127593125,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 47482250,
            range: '±1.4%',
            unit: 'ops/sec',
            extra: '85 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 817655383,
            range: '±1%',
            unit: 'ops/sec',
            extra: '88 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 19185083,
            range: '±1.72%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 823637954,
            range: '±1.16%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 56999,
            range: '±38.49%',
            unit: 'ops/sec',
            extra: '66 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 70959,
            range: '±62.31%',
            unit: 'ops/sec',
            extra: '85 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 265832,
            range: '±36.78%',
            unit: 'ops/sec',
            extra: '52 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 340328,
            range: '±3.01%',
            unit: 'ops/sec',
            extra: '74 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 332639,
            range: '±16.75%',
            unit: 'ops/sec',
            extra: '72 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 331824,
            range: '±2.93%',
            unit: 'ops/sec',
            extra: '73 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 25813,
            range: '±2.52%',
            unit: 'ops/sec',
            extra: '74 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 8731,
            range: '±11.52%',
            unit: 'ops/sec',
            extra: '71 samples',
          },
        ],
      },
    ],
  },
}
