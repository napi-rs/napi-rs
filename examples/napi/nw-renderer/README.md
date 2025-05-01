# NW.js Renderer Test for napi-rs

This test demonstrates running napi-rs native modules in NW.js's renderer process on Windows.

## Building the Example

Build the napi-rs example:

```bash
cd examples/napi
yarn build
```

## Running the Test

From the examples/napi directory, run:

````bash
# Using npm script
yarn test:nwjs

## How it Works

This test loads the napi-rs native module in NW.js and executes various functions to ensure compatibility. The test verifies:

1. Loading native modules in NW.js context
2. Calling threadsafe functions
3. Using abort controllers
4. Working with file I/O
5. Creating and using typed arrays

The test will:
1. Automatically locate the locally installed NW.js executable
2. Launch NW.js with the test app
3. Execute the tests in both Node.js and NW.js contexts
4. Close after completion

## For CI/CD Integration

For CI/CD pipelines, simply add these steps:

```yaml
- name: Install dependencies
  run: cd examples/napi && yarn install

- name: Build example
  run: cd examples/napi && yarn build

- name: Run NW.js test
  run: cd examples/napi && yarn test:nwjs
````
