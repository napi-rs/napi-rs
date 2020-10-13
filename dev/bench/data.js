window.BENCHMARK_DATA = {
  "lastUpdate": 1602608731370,
  "repoUrl": "https://github.com/napi-rs/napi-rs",
  "entries": {
    "Benchmark": [
      {
        "commit": {
          "author": {
            "name": "napi-rs",
            "username": "napi-rs"
          },
          "committer": {
            "name": "napi-rs",
            "username": "napi-rs"
          },
          "id": "f03ada59df0774b0b9d7dd031d5f1efb04fc7ef9",
          "message": "ci: setup benchmark action",
          "timestamp": "2020-10-13T09:40:46Z",
          "url": "https://github.com/napi-rs/napi-rs/pull/230/commits/f03ada59df0774b0b9d7dd031d5f1efb04fc7ef9"
        },
        "date": 1602608730360,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 53081823,
            "range": "±2.06%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 881409678,
            "range": "±1.63%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 13053451,
            "range": "±1.44%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 856744929,
            "range": "±1.75%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Async task#napi-rs",
            "value": 20727,
            "range": "±1.84%",
            "unit": "ops/sec",
            "extra": "79 samples"
          }
        ]
      }
    ]
  }
}