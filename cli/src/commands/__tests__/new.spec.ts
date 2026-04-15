import test from 'ava'

import { getNapiVersionChoices } from '../new.js'
import { SUPPORTED_NAPI_VERSIONS } from '../../utils/version.js'

test('napi version prompt choices track supported versions', (t) => {
  const choices = getNapiVersionChoices()

  t.deepEqual(
    choices.map((choice) => choice.value),
    SUPPORTED_NAPI_VERSIONS,
  )
})
