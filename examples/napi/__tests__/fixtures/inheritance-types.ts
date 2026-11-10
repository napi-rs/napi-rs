// Type-checked by inheritance-types.spec.ts. Every `@ts-expect-error` must
// fire, so the declarations stay instance-only.
import {
  InheritanceBase,
  InheritanceChild,
  InheritanceGrandchild,
  InheritanceSibling,
  inheritanceExactArgument,
} from '../../index.cjs'

const child = InheritanceChild.create(1, 2)
const grandchild = InheritanceGrandchild.create(1, 2, 3)

// Inherited instance members.
export const value: number = child.value + child.amount + child.doubled()
child.increment()
child.amount = 4
export const own: number =
  grandchild.ownValue() + grandchild.doubled() + grandchild.leaf

// A child is assignable to its parent's instance type, minus exact-only members.
export const asChild: InheritanceChild = grandchild
export const asBase: Omit<InheritanceBase, 'exactValue' | 'thisValue'> = child

// @ts-expect-error `Reference<Self>` methods are exact-only.
child.exactValue()
// @ts-expect-error typed `This<&Parent>` methods are exact-only.
child.thisValue()
// @ts-expect-error a child is not a full `InheritanceBase` (exactValue is missing).
export const notBase: InheritanceBase = child
// @ts-expect-error `&Parent` arguments keep exact-class checks.
inheritanceExactArgument(child)

// @ts-expect-error statics and factories are not inherited.
InheritanceChild.fromValue(1)
// @ts-expect-error a child class has no constructor.
new InheritanceChild(1)
// @ts-expect-error siblings are unrelated.
export const notSibling: InheritanceChild = InheritanceSibling.create(1)
