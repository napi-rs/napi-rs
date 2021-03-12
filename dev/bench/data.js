window.BENCHMARK_DATA = {
  lastUpdate: 1615537587369,
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
          id: '526b335df3934e815bee410408fc65c63150773d',
          message:
            'Merge pull request #502 from napi-rs/fix-adjust-external-memory-issue\n\nfix(napi): napi_adjust_external_memory issue on wini686',
          timestamp: '2021-03-12T16:22:10+08:00',
          tree_id: '77c83d833a5b31518bd7f896f81472ade6eb72c9',
          url:
            'https://github.com/napi-rs/napi-rs/commit/526b335df3934e815bee410408fc65c63150773d',
        },
        date: 1615537585956,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 41493474,
            range: '±1%',
            unit: 'ops/sec',
            extra: '89 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 725163857,
            range: '±0.46%',
            unit: 'ops/sec',
            extra: '89 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 17105893,
            range: '±0.52%',
            unit: 'ops/sec',
            extra: '92 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 725250677,
            range: '±0.46%',
            unit: 'ops/sec',
            extra: '87 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 84148,
            range: '±23.27%',
            unit: 'ops/sec',
            extra: '76 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 79098,
            range: '±26.79%',
            unit: 'ops/sec',
            extra: '77 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 383419,
            range: '±3.8%',
            unit: 'ops/sec',
            extra: '69 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 346301,
            range: '±3.42%',
            unit: 'ops/sec',
            extra: '82 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 210546,
            range: '±80.98%',
            unit: 'ops/sec',
            extra: '50 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 326823,
            range: '±3.37%',
            unit: 'ops/sec',
            extra: '83 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 25922,
            range: '±2.06%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 9694,
            range: '±11.31%',
            unit: 'ops/sec',
            extra: '79 samples',
          },
        ],
      },
    ],
  },
}
