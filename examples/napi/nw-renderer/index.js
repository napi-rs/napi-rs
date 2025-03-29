// Set status element for reporting
function setStatus(message, isError = false) {
  const statusElement = document.getElementById('status')
  statusElement.textContent = message
  statusElement.className = isError ? 'error' : 'success'

  console.log(`Status: ${message}`)
}

// Add a result message
function addResult(message, isError = false) {
  const resultsElement = document.getElementById('results')
  const resultElement = document.createElement('div')
  resultElement.textContent = message
  resultElement.className = isError ? 'error' : ''
  resultsElement.appendChild(resultElement)

  console.log(`Result: ${message}`)
}

// Add a formatted result for arrays
function addArrayResult(label, array) {
  const resultsElement = document.getElementById('results')

  // Create container
  const container = document.createElement('div')
  container.className = 'array-result'

  // Add label
  const labelElement = document.createElement('div')
  labelElement.className = 'array-label'
  labelElement.textContent = label
  container.appendChild(labelElement)

  // Add value
  const valueElement = document.createElement('pre')
  valueElement.className = 'array-value'
  valueElement.textContent = `[${array.join(', ')}]`
  container.appendChild(valueElement)

  // Add to results
  resultsElement.appendChild(container)

  console.log(`${label}:`, array)
}

// Run the NW.js tests
try {
  // Access NW.js API
  const nw = window.nw || require('nw.gui')

  if (!nw) {
    throw new Error('NW.js API not available')
  }

  const win = nw.Window.get()

  // Set timeout to close the window after 8 seconds
  setTimeout(() => {
    addResult('Test completed, closing window...')
    win.close(true) // Force close
  }, 2000)

  // Try to directly call the native module
  try {
    // Import the native module
    const nativeModule = require('../index.cjs')
    setStatus('Native module loaded successfully')
    addResult('Successfully required the native module')

    // Call the threadsafe function
    nativeModule.callLongThreadsafeFunction(() => {
      addResult('Callback from threadsafe function executed')
    })

    // MAIN PART: Call the createExternalTypedArray function directly
    try {
      const typedArray = nativeModule.createExternalTypedArray()

      addResult(
        'Successfully created Uint32Array directly in the renderer process',
      )
      addArrayResult('Uint32Array from napi function', Array.from(typedArray))

      // Show the type of the result
      addResult(`Result type: ${typedArray.constructor.name}`)
      addResult(`Array length: ${typedArray.length}`)

      // Add individual elements for clarity
      for (let i = 0; i < typedArray.length; i++) {
        addResult(`Element ${i}: ${typedArray[i]}`)
      }

      // Show available functions from the module at the end
      addResult(`Available functions: ${Object.keys(nativeModule).join(', ')}`)
    } catch (typedArrayErr) {
      addResult(`Error creating Uint32Array: ${typedArrayErr.message}`, true)
      console.error('TypedArray error:', typedArrayErr)

      // Still show available functions even if the typed array failed
      addResult(`Available functions: ${Object.keys(nativeModule).join(', ')}`)
    }
  } catch (moduleErr) {
    setStatus('Failed to load or use native module', true)
    addResult(`Module error: ${moduleErr.message}`, true)
    console.error('Module error:', moduleErr)
  }
} catch (nwErr) {
  setStatus('Failed to initialize NW.js environment', true)
  addResult(`NW.js error: ${nwErr.message}`, true)
  console.error('NW.js error:', nwErr)
}
