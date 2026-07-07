import test from 'ava'

import { duplicateClassNameAlpha, duplicateClassNameBeta } from '../index.cjs'

test('same JS class name in different namespaces keeps constructors isolated', (t) => {
  const AlphaSharedClass = duplicateClassNameAlpha.SharedClass
  const BetaSharedClass = duplicateClassNameBeta.SharedClass

  t.not(AlphaSharedClass, BetaSharedClass)
  t.not(AlphaSharedClass.prototype, BetaSharedClass.prototype)

  const alphaDirect = new AlphaSharedClass(1)
  const alphaFactory = AlphaSharedClass.create(10)
  const alphaReturned = alphaDirect.incremented()
  const betaDirect = new BetaSharedClass(2)
  const betaFactory = BetaSharedClass.create(20)
  const betaReturned = betaDirect.incremented()

  for (const value of [alphaDirect, alphaFactory, alphaReturned]) {
    t.true(value instanceof AlphaSharedClass)
    t.false(value instanceof BetaSharedClass)
    t.is(Object.getPrototypeOf(value), AlphaSharedClass.prototype)
    t.not(Object.getPrototypeOf(value), BetaSharedClass.prototype)
    t.is(value.namespace, 'alpha')
  }

  for (const value of [betaDirect, betaFactory, betaReturned]) {
    t.true(value instanceof BetaSharedClass)
    t.false(value instanceof AlphaSharedClass)
    t.is(Object.getPrototypeOf(value), BetaSharedClass.prototype)
    t.not(Object.getPrototypeOf(value), AlphaSharedClass.prototype)
    t.is(value.namespace, 'beta')
  }

  t.is(alphaDirect.value, 1)
  t.is(alphaFactory.value, 10)
  t.is(alphaReturned.value, 2)
  t.is(betaDirect.value, 2)
  t.is(betaFactory.value, 20)
  t.is(betaReturned.value, 3)
})
