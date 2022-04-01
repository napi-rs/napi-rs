window.BENCHMARK_DATA = {
  "lastUpdate": 1648796050006,
  "repoUrl": "https://github.com/napi-rs/napi-rs",
  "entries": {
    "Benchmark": [
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "ae45d335f8e4a4b73845595f188b5a8be42982b7",
          "message": "Merge pull request #1113 from napi-rs/upgrade-ci-config\n\nci: upgrade configuration",
          "timestamp": "2022-04-01T14:47:17+08:00",
          "tree_id": "2c01aa69535a5349c33a0f8052df8dcbb20ad970",
          "url": "https://github.com/napi-rs/napi-rs/commit/ae45d335f8e4a4b73845595f188b5a8be42982b7"
        },
        "date": 1648796049021,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 61223218,
            "range": "±1.58%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 810503885,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20807811,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 755610355,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 369798,
            "range": "±9.49%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1779468,
            "range": "±3.27%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42650,
            "range": "±1.22%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8019,
            "range": "±1.25%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7452,
            "range": "±0.47%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16867,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10163,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12231,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 391356,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 341281,
            "range": "±5.34%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 343115,
            "range": "±5.11%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 310836,
            "range": "±5.7%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 32212,
            "range": "±3.88%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 363,
            "range": "±3.04%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 26819,
            "range": "±3.64%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2023,
            "range": "±3.11%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 25169,
            "range": "±5.47%",
            "unit": "ops/sec",
            "extra": "72 samples"
          }
        ]
      }
    ]
  }
}