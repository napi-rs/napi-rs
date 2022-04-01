window.BENCHMARK_DATA = {
  "lastUpdate": 1648805005590,
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
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "0009379f3138d4adc9f7275b75e8e83448a0864f",
          "message": "chore: publish\n\n - @napi-rs/cli@2.5.0",
          "timestamp": "2022-04-01T14:50:23+08:00",
          "tree_id": "52d63210f214c0cdee02ec59585788db535a81ad",
          "url": "https://github.com/napi-rs/napi-rs/commit/0009379f3138d4adc9f7275b75e8e83448a0864f"
        },
        "date": 1648796479950,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 49689837,
            "range": "±1.81%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 813766281,
            "range": "±1.05%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17445595,
            "range": "±1.71%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 818334034,
            "range": "±1.17%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 309295,
            "range": "±10.13%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1530136,
            "range": "±7.32%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37029,
            "range": "±1.16%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6748,
            "range": "±0.79%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6660,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15633,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8983,
            "range": "±0.83%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 11266,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 341606,
            "range": "±5.69%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 325185,
            "range": "±5.54%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 322666,
            "range": "±5.78%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 287801,
            "range": "±6.33%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 32667,
            "range": "±2.72%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 405,
            "range": "±4.28%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24232,
            "range": "±2.08%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1783,
            "range": "±3.2%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22759,
            "range": "±2.51%",
            "unit": "ops/sec",
            "extra": "78 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "a88bc57ea302e674596831015a768649b45db81e",
          "message": "chore: publish\n\n - @napi-rs/cli@2.6.0",
          "timestamp": "2022-04-01T14:51:38+08:00",
          "tree_id": "bfa765ee586cff5a6306486b9e3f8f9343dbb683",
          "url": "https://github.com/napi-rs/napi-rs/commit/a88bc57ea302e674596831015a768649b45db81e"
        },
        "date": 1648796553305,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 47478078,
            "range": "±1.95%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 815057180,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16850139,
            "range": "±1.65%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 793494738,
            "range": "±1.24%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 301822,
            "range": "±10.68%",
            "unit": "ops/sec",
            "extra": "58 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1401444,
            "range": "±4.15%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 35881,
            "range": "±1.42%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6657,
            "range": "±1.09%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6613,
            "range": "±1.12%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14543,
            "range": "±1.57%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8094,
            "range": "±1.25%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10108,
            "range": "±1.44%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 343450,
            "range": "±5.4%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 311129,
            "range": "±5.22%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 339305,
            "range": "±4.77%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 321413,
            "range": "±5.15%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36984,
            "range": "±2.71%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 399,
            "range": "±3.65%",
            "unit": "ops/sec",
            "extra": "62 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 23809,
            "range": "±3.13%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1876,
            "range": "±2.71%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22442,
            "range": "±2.69%",
            "unit": "ops/sec",
            "extra": "77 samples"
          }
        ]
      },
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
          "id": "83712d7312eb99e2f6483d5da9a8f010c994fe20",
          "message": "Merge pull request #1115 from napi-rs/fix-cargo-name-restrict\n\nfix(cli): should not throw if cargoName is provided but no package.name",
          "timestamp": "2022-04-01T17:19:11+08:00",
          "tree_id": "26bd59b4f47d99e8ac5ffeb1634944f61930383e",
          "url": "https://github.com/napi-rs/napi-rs/commit/83712d7312eb99e2f6483d5da9a8f010c994fe20"
        },
        "date": 1648805004425,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 44312755,
            "range": "±1.99%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 883050869,
            "range": "±1.37%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19181691,
            "range": "±1.85%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 879317422,
            "range": "±1.5%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 341994,
            "range": "±10.83%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1553643,
            "range": "±4.42%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36055,
            "range": "±1.21%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6154,
            "range": "±1.07%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6418,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15290,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8960,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 11044,
            "range": "±1.27%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 394664,
            "range": "±5.96%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 325024,
            "range": "±5.54%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 346909,
            "range": "±5.38%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 323106,
            "range": "±5.69%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 33071,
            "range": "±4.13%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 406,
            "range": "±7.01%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24732,
            "range": "±2.83%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1837,
            "range": "±2.16%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 23552,
            "range": "±2.08%",
            "unit": "ops/sec",
            "extra": "78 samples"
          }
        ]
      }
    ]
  }
}