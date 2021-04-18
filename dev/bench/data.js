window.BENCHMARK_DATA = {
  lastUpdate: 1618766747893,
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
          id: 'd5192e05a55d48fe1938fdbf99ca52ab4b7f1a16',
          message:
            'Merge pull request #535 from DeMoorJasper/tweak-build-command',
          timestamp: '2021-04-19T01:20:48+08:00',
          tree_id: '629d086e03fc0ebc83f3100787cdd108074175c3',
          url:
            'https://github.com/napi-rs/napi-rs/commit/d5192e05a55d48fe1938fdbf99ca52ab4b7f1a16',
        },
        date: 1618766744560,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 38724628,
            range: '±1.64%',
            unit: 'ops/sec',
            extra: '88 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 683426774,
            range: '±1%',
            unit: 'ops/sec',
            extra: '88 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 16163345,
            range: '±1.22%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 676562280,
            range: '±1.09%',
            unit: 'ops/sec',
            extra: '88 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 70844,
            range: '±23.99%',
            unit: 'ops/sec',
            extra: '70 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 64472,
            range: '±33.1%',
            unit: 'ops/sec',
            extra: '69 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 349067,
            range: '±3.82%',
            unit: 'ops/sec',
            extra: '74 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 318747,
            range: '±3.51%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 331746,
            range: '±4%',
            unit: 'ops/sec',
            extra: '78 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 307630,
            range: '±3.18%',
            unit: 'ops/sec',
            extra: '83 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 23792,
            range: '±2.61%',
            unit: 'ops/sec',
            extra: '77 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 7611,
            range: '±11.99%',
            unit: 'ops/sec',
            extra: '67 samples',
          },
        ],
      },
    ],
  },
}
