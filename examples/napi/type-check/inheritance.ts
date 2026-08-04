// Type-level proof for `#[napi(extends = Parent)]` typegen (issue #1164).
//
// The generated `.d.ts` describes single inheritance as INSTANCE-only, via
// declaration merging (`export interface Child extends Parent {}`), never as
// `class Child extends Parent`. This file is checked by `tsc --noEmit` (see the
// `type-check` script): the positive block must compile, and every negative is
// guarded by `@ts-expect-error`, so the file type-checks only if each negative
// genuinely fails to compile. If any negative ever started compiling, the now
// unused `@ts-expect-error` would itself become a type error and fail the run.
//
// It is intentionally NOT a `*.spec.ts` — it exercises the compiler, not the
// runtime, so it is never executed by ava.

import {
  Base,
  CssConditionRule,
  CssMediaRule,
  CssRule,
  CssStyleRule,
  Sub,
} from '../index.cjs'

// --------------------------------------------------------------------------
// Positive: inherited *instance* members are visible on a descendant, at every
// level of the chain, through the merged interfaces.
// --------------------------------------------------------------------------

export function readsInheritedInstanceMembers(): number {
  const media = CssMediaRule.create(10, 20, 30, 40)

  // getters inherited from every ancestor (3 levels up to own):
  const ruleType: number = media.ruleType // CssRule (root)
  const groupSize: number = media.groupSize // CssGroupingRule
  const condition: number = media.condition // CssConditionRule
  const ownMedia: number = media.media // own

  // methods inherited from every ancestor:
  const k1: number = media.ruleKind() // CssRule
  const k2: number = media.groupingKind() // CssGroupingRule
  const k3: number = media.conditionKind() // CssConditionRule
  const k4: number = media.mediaKind() // own

  // an inherited setter is writable through the descendant:
  media.ruleType = 99

  return ruleType + groupSize + condition + ownMedia + k1 + k2 + k3 + k4
}

export function subReadsInheritedBaseMembers(): number {
  const sub = Sub.create(10, 5)
  // `value`/`doubled` come from Base; `extra` is Sub's own.
  const value: number = sub.value
  const doubled: number = sub.doubled()
  const extra: number = sub.extra
  sub.value = 20 // inherited Base setter
  return value + doubled + extra
}

export function exactReceiverMethodIsNotInherited(): unknown {
  const sub = Sub.create(10, 5)
  // @ts-expect-error - Reference<Self> methods require an exact Base receiver at runtime.
  return sub.refValue()
}

// Referenced so the imports of intermediate levels are not unused; also proves
// each intermediate level is itself constructible via its own factory.
export function intermediateLevelsAreConstructible(): number {
  return (
    CssConditionRule.create(1, 2, 3).conditionKind() +
    CssRule.prototype.ruleKind.call(CssMediaRule.create(1, 2, 3, 4))
  )
}

// --------------------------------------------------------------------------
// Negative: statics/factories are NOT inherited (v1 wires only the instance
// prototype chain, never the constructor chain), and instance inheritance is
// strictly descendant -> ancestor (never the reverse, never across siblings).
// --------------------------------------------------------------------------

// A parent factory is not reachable on the child constructor.
export const parentFactoryNotInheritedBySub =
  // @ts-expect-error - Base.fromValue is a parent factory; Sub does not inherit statics.
  Sub.fromValue

// A parent plain static is not reachable on the child constructor.
export const parentStaticNotInheritedBySub =
  // @ts-expect-error - Base.baseStatic is a parent static; Sub does not inherit statics.
  Sub.baseStatic

// Instance inheritance does not flow ancestor -> descendant: a root instance
// has none of a descendant's members.
export function rootHasNoDescendantMembers(): unknown {
  const root = new CssRule(1)
  // @ts-expect-error - mediaKind is a CssMediaRule (descendant) method, not on the root.
  return root.mediaKind()
}

// Instance inheritance does not leak across sibling branches: CssStyleRule and
// CssGroupingRule share only the common root, so neither sees the other's members.
export function siblingBranchesAreNotMerged(): unknown {
  const style = CssStyleRule.create(7, 5)
  // @ts-expect-error - groupingKind is on the CssGroupingRule branch, not the sibling CssStyleRule.
  return style.groupingKind()
}

// `Base` itself is a plain (non-extends) class: it must NOT be typed as
// inheriting from anything, so referencing a made-up ancestor member errors.
export function baseHasNoPhantomParent(): unknown {
  const base = new Base(7)
  // @ts-expect-error - Base has no parent; `ruleType` belongs to the unrelated CssRule chain.
  return base.ruleType
}
