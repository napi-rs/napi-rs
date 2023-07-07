import { EventEmitter } from 'events'

import test from 'ava'

import { emitterSync, callbackArgsWithCallEmit } from '../'

test('should trigger events', (t) => {
  t.plan(5)

  return new Promise((resolve) => {
    const emitter = new EventEmitter()
    // Trigger 4 times;
    emitter.on('data', (data) => {
      t.is(data, 'Hello,World')
    })

    emitter.on('end', () => {
      t.pass()
      resolve()
    })

    emitterSync(emitter.emit.bind(emitter))
  })
})

test('should callback arguments with a call emit and triggering events', (t) => {
  t.plan(5)

  return new Promise((resolve) => {
    callbackArgsWithCallEmit((_err, req) => {
      const emitter = new EventEmitter()
      // Trigger 4 times;
      emitter.on('data', (data) => {
        t.is(data, 'Hello,World')
      })

      emitter.on('end', () => {
        t.pass()
        resolve()
      })

      req._callEmit(emitter.emit.bind(emitter))
    })
  })
})
