const assert = require('node:assert');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const FILE_CONTENT = readFileSync(__filename, 'utf8');

// Function to launch NW.js with our app
const createWindowAndReload = async () => {
  return new Promise((resolve, reject) => {
    // Find the NW.js executable path
    // First try the local node_modules (installed as devDependency)
    let nwPath;
    const isWindows = process.platform === 'win32';
    
    // Check various possible locations for the NW.js executable
    const possiblePaths = [
      // Local install in node_modules
      path.resolve(__dirname, 'node_modules/.bin/nw' + (isWindows ? '.cmd' : '')),
      // Install in parent directory's node_modules
      path.resolve(__dirname, '../../node_modules/.bin/nw' + (isWindows ? '.cmd' : '')),
      // Global install (fallback)
      'nw' + (isWindows ? '.cmd' : '')
    ];
    
    // Find the first path that exists
    for (const possiblePath of possiblePaths) {
      if (existsSync(possiblePath)) {
        nwPath = possiblePath;
        break;
      }
    }
    
    if (!nwPath) {
      console.error('NW.js executable not found. Please install NW.js:');
      console.error('npm install --save-dev nw');
      return reject(new Error('NW.js executable not found'));
    }
    
    const nwAppPath = path.resolve(__dirname, 'nw-renderer');
    
    console.log(`Starting NW.js at: ${nwPath}`);
    console.log(`App path: ${nwAppPath}`);
    
    // Add special arguments for debugging if needed
    const nwArgs = [
      nwAppPath,
      // Uncomment for more verbose logging
      // '--enable-logging=stderr',
      // '--v=1'
    ];
    
    const nw = spawn(nwPath, nwArgs, {
      stdio: 'inherit',
      shell: true,
      windowsHide: false
    });
    
    console.log('NW.js window should be visible now');
    console.log('The renderer process will directly call the createExternalTypedArray() function');
    console.log('Check the NW.js window for test results');
    
    // For tests, we can use a longer timeout to make sure everything loads properly
    // and give more time to see the test results in the window
    // The window will close itself from within the renderer after 8 seconds
    setTimeout(() => {
      console.log('Waiting for NW.js window to close itself...');
    }, 2000);
    
    // Wait for the process to exit naturally when the window is closed
    nw.on('error', (err) => {
      console.error('Failed to start NW.js:', err);
      reject(err);
    });
    
    nw.on('exit', (code) => {
      console.log('NW.js process exited');
      if (code !== 0 && code !== null) {
        reject(new Error(`NW.js exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
};

async function main() {
  const {
    readFileAsync,
    callThreadsafeFunction,
    withAbortController,
    createExternalTypedArray,
  } = require('./index.cjs');

  const ctrl = new AbortController();
  const promise = withAbortController(1, 2, ctrl.signal);
  try {
    ctrl.abort();
    await promise;
    throw new Error('Should throw AbortError');
  } catch (err) {
    assert(err.message === 'AbortError');
  }

  const buf = await readFileAsync(__filename);
  assert(FILE_CONTENT === buf.toString('utf8'));

  const value = await new Promise((resolve, reject) => {
    let i = 0;
    let value = 0;
    callThreadsafeFunction((err, v) => {
      if (err != null) {
        reject(err);
        return;
      }
      i++;
      value += v;
      if (i === 100) {
        resolve(value);
      }
    });
  });

  assert(
    value ===
      Array.from({ length: 100 }, (_, i) => i).reduce((a, b) => a + b),
  );
  
  // Log the typed array result in the main process as well
  console.info('Main process Uint32Array result:', createExternalTypedArray());
}

Promise.all([main(), createWindowAndReload()])
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  }); 