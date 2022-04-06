import { createRequire } from 'module'

import { displayMemoryUsageFromNode } from './util.mjs'

const initialMemoryUsage = process.memoryUsage()

const require = createRequire(import.meta.url)

const api = require(`./index.node`)

const data = {
  id: 'ckovh15xa104945sj64rdk8oas',
  name: '1883da9ff9152',
  forename: '221c99bedc6a4',
  description: '8bf86b62ce6a',
  email: '9d57a869661cc',
  phone: '7e0c58d147215',
  arrivalDate: -92229669,
  departureDate: 202138795,
  price: -1592700387,
  advance: -369294193,
  advanceDueDate: 925000428,
  kids: 520124290,
  adults: 1160258464,
  status: 'NO_PAYMENT',
  nourishment: 'BB',
  createdAt: '2021-05-19T12:58:37.246Z',
  room: { id: 'ckovh15xa104955sj6r2tqaw1c', name: '38683b87f2664' },
}

let i = 1
// eslint-disable-next-line no-constant-condition
while (true) {
  api.fromJs(data)
  if (i % 100000 === 0) {
    displayMemoryUsageFromNode(initialMemoryUsage)
  }
  i++
}
