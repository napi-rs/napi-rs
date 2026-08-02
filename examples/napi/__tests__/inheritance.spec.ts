import test from 'ava'

import {
  Base,
  Sub,
  CssRule,
  CssGroupingRule,
  CssConditionRule,
  CssMediaRule,
  CssStyleRule,
  // A wholly unrelated `#[napi]` class, reused as a "foreign" receiver in the
  // adversarial cases below.
  TypeTagA,
} from '../index.cjs'

// `#[napi(extends = Parent)]` relies on two things that are native + napi8 only:
// the object type tag the receiver check consults for the descendant fallback
// (a no-op on wasm — see type-tag.spec.ts), and the P8 method rebuild that lets
// a descendant reach an inherited *plain method* (gated to `napi8` + non-wasm).
// The instance prototype wiring (which powers `instanceof` and inherited
// accessors) is pure `Object.setPrototypeOf` and would work more broadly, but to
// keep one predictable oracle every inheritance assertion below is native-only,
// exactly like the tag-rejection tests in type-tag.spec.ts.
const nativeOnly = process.env.WASI_TEST ? test.skip : test

// ---------------------------------------------------------------------------
// The issue's own example: a 4-level CSS-OM chain
//   CssRule <- CssGroupingRule <- CssConditionRule <- CssMediaRule
// plus a sibling `CssStyleRule <- CssRule`.
// ---------------------------------------------------------------------------

nativeOnly('multi-level instanceof holds across the whole chain', (t) => {
  const media = CssMediaRule.create(10, 20, 30, 40)

  // a deep instance is an instance of every ancestor, including the root three
  // levels up.
  t.true(media instanceof CssMediaRule)
  t.true(media instanceof CssConditionRule)
  t.true(media instanceof CssGroupingRule)
  t.true(media instanceof CssRule)

  // ...but not of a sibling branch.
  t.false(media instanceof CssStyleRule)

  // and instanceof is descendant->ancestor only, never the reverse: a root
  // instance is not an instance of any descendant.
  const root = new CssRule(1)
  t.false(root instanceof CssGroupingRule)
  t.false(root instanceof CssMediaRule)
})

nativeOnly(
  'only the instance prototype chain is wired, never the constructor chain',
  (t) => {
    // Child.prototype -> Parent.prototype, for every edge.
    t.is(
      Object.getPrototypeOf(CssMediaRule.prototype),
      CssConditionRule.prototype,
    )
    t.is(
      Object.getPrototypeOf(CssConditionRule.prototype),
      CssGroupingRule.prototype,
    )
    t.is(Object.getPrototypeOf(CssGroupingRule.prototype), CssRule.prototype)

    // But the constructor is deliberately NOT re-parented (v1 does not inherit
    // statics/factories), so `Child.someParentStatic` stays undefined.
    t.not(Object.getPrototypeOf(CssMediaRule), CssConditionRule)
    t.not(Object.getPrototypeOf(CssGroupingRule), CssRule)
  },
)

nativeOnly(
  'a root getter/setter round-trips through the deepest instance',
  (t) => {
    const media = CssMediaRule.create(10, 20, 30, 40)

    // every ancestor's field getter is readable on the deep instance...
    t.is(media.ruleType, 10) // CssRule (root, 3 levels up)
    t.is(media.groupSize, 20) // CssGroupingRule
    t.is(media.condition, 30) // CssConditionRule
    t.is(media.media, 40) // own

    // ...and the root setter is writable through it.
    media.ruleType = 99
    t.is(media.ruleType, 99)
    // writing the root field leaves the descendant fields untouched.
    t.is(media.groupSize, 20)
    t.is(media.media, 40)
  },
)

nativeOnly(
  'each ancestor plain method dispatches on a descendant receiver',
  (t) => {
    const media = CssMediaRule.create(10, 20, 30, 40)
    // 1/2/3 come from ancestor methods reached via the prototype chain (the P8
    // rebuild), 4 is the instance's own method.
    t.is(media.ruleKind(), 1)
    t.is(media.groupingKind(), 2)
    t.is(media.conditionKind(), 3)
    t.is(media.mediaKind(), 4)

    // an intermediate instance sees exactly its own level and above, never below.
    const condition = CssConditionRule.create(1, 2, 3)
    t.is(condition.ruleKind(), 1)
    t.is(condition.groupingKind(), 2)
    t.is(condition.conditionKind(), 3)
    t.is(typeof (condition as any).mediaKind, 'undefined')
  },
)

nativeOnly('a sibling branch is never confused with the other', (t) => {
  const style = CssStyleRule.create(7, 5)

  // shares only the common root.
  t.true(style instanceof CssRule)
  t.false(style instanceof CssGroupingRule)
  t.false(style instanceof CssMediaRule)

  // reaches the root's method, but none of the CssGroupingRule branch's.
  t.is(style.ruleKind(), 1)
  t.is(style.styleKind(), 5)
  t.is(typeof (style as any).groupingKind, 'undefined')
  t.is(typeof (style as any).conditionKind, 'undefined')
})

// ---------------------------------------------------------------------------
// Base/Sub: the compact fixture carrying the "special members" — a setter, a
// plain method, a `Reference<Self>` (Exact) method, a static, and a factory.
// ---------------------------------------------------------------------------

nativeOnly('an inherited getter and setter work through a child', (t) => {
  const sub = Sub.create(10, 5)
  t.is(sub.value, 10) // Base getter via Sub
  t.is(sub.extra, 5) // Sub's own getter

  sub.value = 20 // Base setter via Sub
  t.is(sub.value, 20)
  t.is(sub.extra, 5) // untouched
})

nativeOnly(
  'an inherited BorrowedUpcast plain method works through a child',
  (t) => {
    const sub = Sub.create(10, 5)
    t.is(sub.doubled(), 20)
    // also callable explicitly off the base prototype.
    t.is(Base.prototype.doubled.call(sub), 20)

    // the base's own instances are unaffected.
    const base = new Base(7)
    t.is(base.doubled(), 14)
  },
)

nativeOnly(
  'an Exact (`Reference<Self>`) method is refused on a child but works on the base',
  (t) => {
    const sub = Sub.create(10, 5)
    // `ref_value` takes a `Reference<Self>`, so it keeps the exact tag-checked
    // receiver unwrap and is never rebuilt by P8. Called on a descendant it must
    // throw — a V8 `Illegal invocation` on Node, a clean tag mismatch on a
    // runtime that does not enforce the signature. The message differs by
    // runtime (see type-tag.spec.ts), so assert only that it throws.
    t.truthy(t.throws(() => sub.refValue()))

    // it still works on a real Base instance.
    const base = new Base(7)
    t.is(base.refValue(), 7)
  },
)

nativeOnly('statics and factories are not inherited by a child', (t) => {
  // the parent's own static and factory keep working...
  t.is(Base.baseStatic(), 42)
  t.is(Base.fromValue(7).value, 7)

  // ...but neither is reachable on the child (no constructor-side wiring).
  t.is(typeof (Sub as any).baseStatic, 'undefined')
  t.is(typeof (Sub as any).fromValue, 'undefined')

  // the child's own factory is of course present.
  t.is(typeof Sub.create, 'function')
})

// ---------------------------------------------------------------------------
// Adversarial: dropping the V8 signature from a rebuilt method means the tag
// check is the sole guard, so it must reject every non-descendant receiver.
// These mirror the receiver-/prototype-spoof cases in type-tag.spec.ts (which
// continues to pass unmodified alongside this file).
// ---------------------------------------------------------------------------

nativeOnly(
  'a spoofed prototype does not smuggle a foreign receiver in',
  (t) => {
    // a plain object re-parented onto a base prototype passes `instanceof`
    // (prototype walk) but must still be rejected when a rebuilt method runs on
    // it — the object was never napi-wrapped, so the unwrap fails cleanly.
    const spoof = {}
    Object.setPrototypeOf(spoof, CssRule.prototype)
    t.true(spoof instanceof CssRule)
    t.truthy(t.throws(() => CssRule.prototype.ruleKind.call(spoof)))
    t.truthy(t.throws(() => Base.prototype.doubled.call(spoof)))
  },
)

nativeOnly(
  'a foreign wrapped instance is rejected by the tag, not read as the base',
  (t) => {
    // a real, wrapped instance of an unrelated class reaching a signature-free
    // rebuilt method is rejected by its own tag check — never a type-confused
    // read of foreign memory as the base type.
    const foreign = new TypeTagA(123)
    const err = t.throws(() => Base.prototype.doubled.call(foreign as any))
    t.truthy(err)
    t.regex(String((err as Error).message), /not an instance of class/)

    // same guard for the CSS chain's rebuilt root method.
    t.truthy(t.throws(() => CssRule.prototype.ruleKind.call(foreign as any)))
  },
)

// ---------------------------------------------------------------------------
// Subclassing from JavaScript still works (the native super() stamps the base
// tag), mirroring type-tag.spec.ts's subclass test.
// ---------------------------------------------------------------------------

nativeOnly('a plain JS subclass of a base still passes the tag check', (t) => {
  class JsRule extends CssRule {
    constructor() {
      super(5)
    }
  }

  const r = new JsRule()
  t.true(r instanceof JsRule)
  t.true(r instanceof CssRule)
  t.is(r.ruleType, 5)
  t.is(r.ruleKind(), 1)
})

// ---------------------------------------------------------------------------
// Adversarial: every ancestor's setter (not just the root's) must be writable
// through the deepest descendant, at every level of the chain, and writing one
// level must never disturb another.
// ---------------------------------------------------------------------------

nativeOnly(
  'every ancestor setter is writable through the deepest descendant',
  (t) => {
    const media = CssMediaRule.create(10, 20, 30, 40)

    // write each level's field through the deep instance...
    media.ruleType = 11 // CssRule (root, 3 levels up)
    media.groupSize = 22 // CssGroupingRule
    media.condition = 33 // CssConditionRule
    media.media = 44 // own

    // ...and read each back, independent of the others.
    t.is(media.ruleType, 11)
    t.is(media.groupSize, 22)
    t.is(media.condition, 33)
    t.is(media.media, 44)

    // an intermediate instance's setters are likewise writable at its own level
    // and every level above, but it never gains a descendant's field.
    const condition = CssConditionRule.create(1, 2, 3)
    condition.ruleType = 111
    condition.groupSize = 222
    condition.condition = 333
    t.is(condition.ruleType, 111)
    t.is(condition.groupSize, 222)
    t.is(condition.condition, 333)
    t.is(typeof (condition as any).media, 'undefined')
  },
)

// ---------------------------------------------------------------------------
// Previously-deferred edge tests, now landed in dedicated specs (each needs a
// setup this deterministic, single-addon suite cannot provide):
//
// * Colliding/broken-hierarchy fail-fast under two concurrent worker_threads —
//   `broken-hierarchy.spec.ts` (a separate `napi-broken-hierarchy` fixture addon
//   that hand-forces a broken hierarchy through `register_class`, since one
//   cannot arise from ordinary macro use). Proves the `get_or_init` +
//   `FirstRegistrationGuard` fail fast rather than hang; the `Err` paths
//   themselves are covered by the `build_hierarchy` unit tests.
//
// * A build WITHOUT `napi8` still throwing `Illegal invocation` for an inherited
//   plain method — `no-napi8-inheritance.spec.ts` (a separate `napi-no-napi8`
//   fixture addon compiled without napi8). Pins the pre-P8 status quo.
//
// * ObjectFinalize-not-chained / Drop-exactly-once — `inheritance-gc.spec.ts`
//   (native `AtomicU32` counters + `--expose-gc`, like memory-test.ts). Proves a
//   finalized child runs its own Drop and the embedded parent's Drop but never
//   the parent's custom ObjectFinalize, while a finalized parent runs both.
// ---------------------------------------------------------------------------
