import test from 'ava'

import type {
  PropertyNameDigitTest,
  PropertyNameSpecialCharsTest,
  PropertyNameUnicodeTest,
  PropertyNameValidTest,
} from '../index.cjs'

test('Unicode property names should be unquoted', (t) => {
  // These should compile without quotes
  const obj: PropertyNameUnicodeTest = {
    café: 'coffee',
    日本語: 'japanese',
    Ελληνικά: 'greek',
  }

  t.is(obj.café, 'coffee')
  t.is(obj.日本語, 'japanese')
  t.is(obj.Ελληνικά, 'greek')
})

test('Special character property names should be quoted', (t) => {
  // These require quotes in the type definition
  const obj: PropertyNameSpecialCharsTest = {
    'kebab-case': 'value1',
    'with space': 'value2',
    'dot.notation': 'value3',
    'xml:lang': 'value4',
    $var: 'value5',
  }

  t.is(obj['kebab-case'], 'value1')
  t.is(obj['with space'], 'value2')
  t.is(obj['dot.notation'], 'value3')
  t.is(obj['xml:lang'], 'value4')
  t.is(obj['$var'], 'value5')
})

test('Digit-starting property names should be quoted', (t) => {
  // These require quotes because they start with digits
  const obj: PropertyNameDigitTest = {
    '0invalid': 'value1',
    '123': 'value2',
  }

  t.is(obj['0invalid'], 'value1')
  t.is(obj['123'], 'value2')
})

test('Valid identifier property names should be unquoted', (t) => {
  // These should compile without quotes
  const obj: PropertyNameValidTest = {
    camelCase: 'value1',
    pascalCase: 'value2',
    private: 'value3',
    with123Numbers: 'value4',
  }

  t.is(obj.camelCase, 'value1')
  t.is(obj.pascalCase, 'value2')
  t.is(obj.private, 'value3')
  t.is(obj.with123Numbers, 'value4')
})
