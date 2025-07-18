# Snapshot report for `src/utils/__tests__/typegen.spec.ts`

The actual snapshot is saved in `typegen.spec.ts.snap`.

Generated by [AVA](https://avajs.dev).

## should ident string correctly

> original ident is 0

    `␊
    /**␊
     * should keep␊
     * class A {␊
     * foo = () => {}␊
     *   bar = () => {}␊
     * }␊
     */␊
    class A {␊
      foo() {␊
        a = b␊
      }␊
    ␊
      bar = () => {␊
    ␊
      }␊
      boz = 1␊
    }␊
    ␊
    namespace B {␊
      namespace C {␊
        type D = A␊
      }␊
    }␊
    `

> original ident is 2

    `␊
      /**␊
       * should keep␊
       * class A {␊
       * foo = () => {}␊
       *   bar = () => {}␊
       * }␊
       */␊
      class A {␊
        foo() {␊
          a = b␊
        }␊
    ␊
        bar = () => {␊
    ␊
        }␊
        boz = 1␊
      }␊
    ␊
      namespace B {␊
        namespace C {␊
          type D = A␊
        }␊
      }␊
    `

## should process type def correctly

> Snapshot 1

    `/**␊
     * \`constructor\` option for \`struct\` requires all fields to be public,␊
     * otherwise tag impl fn as constructor␊
     * #[napi(constructor)]␊
     */␊
    export declare class Animal {␊
      /** Kind of animal */␊
      readonly kind: Kind␊
      /** This is the constructor */␊
      constructor(kind: Kind, name: string)␊
      /** This is a factory method */␊
      static withKind(kind: Kind): Animal␊
      get name(): string␊
      set name(name: string)␊
      get type(): Kind␊
      set type(kind: Kind)␊
      /**␊
       * This is a␊
       * multi-line comment␊
       * with an emoji 🚀␊
       */␊
      whoami(): string␊
      /** This is static... */␊
      static getDogKind(): Kind␊
      /**␊
       * Here are some characters and character sequences␊
       * that should be escaped correctly:␊
       * \\[]{}/\\:""{␊
       * }␊
       */␊
      returnOtherClass(): Dog␊
      returnOtherClassWithCustomConstructor(): Bird␊
      overrideIndividualArgOnMethod(normalTy: string, overriddenTy: {n: string}): Bird␊
    }␊
    ␊
    export declare class AnimalWithDefaultConstructor {␊
      name: string␊
      kind: number␊
      constructor(name: string, kind: number)␊
    }␊
    ␊
    export declare class AnotherClassForEither {␊
      constructor()␊
    }␊
    ␊
    export declare class AnotherCssStyleSheet {␊
      get rules(): CssRuleList␊
    }␊
    export type AnotherCSSStyleSheet = AnotherCssStyleSheet␊
    ␊
    export declare class Asset {␊
      constructor()␊
      get filePath(): number␊
    }␊
    export type JsAsset = Asset␊
    ␊
    export declare class Assets {␊
      constructor()␊
      get(id: number): JsAsset | null␊
    }␊
    export type JsAssets = Assets␊
    ␊
    export declare class Bird {␊
      name: string␊
      constructor(name: string)␊
      getCount(): number␊
      getNameAsync(): Promise<string>␊
    }␊
    ␊
    /** Smoking test for type generation */␊
    export declare class Blake2BHasher {␊
      static withKey(key: Blake2bKey): Blake2BHasher␊
      update(data: Buffer): void␊
    }␊
    export type Blake2bHasher = Blake2BHasher␊
    ␊
    export declare class Blake2BKey {␊
    ␊
    }␊
    export type Blake2bKey = Blake2BKey␊
    ␊
    export declare class ClassWithFactory {␊
      name: string␊
      static withName(name: string): ClassWithFactory␊
      setName(name: string): this␊
    }␊
    ␊
    export declare class Context {␊
      maybeNeed?: boolean␊
      buffer: Uint8Array␊
      constructor()␊
      static withData(data: string): Context␊
      static withBuffer(buf: Uint8Array): Context␊
      method(): string␊
    }␊
    ␊
    export declare class CssRuleList {␊
      getRules(): Array<string>␊
      get parentStyleSheet(): CSSStyleSheet␊
      get name(): string | null␊
    }␊
    export type CSSRuleList = CssRuleList␊
    ␊
    export declare class CssStyleSheet {␊
      constructor(name: string, rules: Array<string>)␊
      get rules(): CssRuleList␊
      anotherCssStyleSheet(): AnotherCssStyleSheet␊
    }␊
    export type CSSStyleSheet = CssStyleSheet␊
    ␊
    export declare class CustomFinalize {␊
      constructor(width: number, height: number)␊
    }␊
    ␊
    export declare class Dog {␊
      name: string␊
      constructor(name: string)␊
    }␊
    ␊
    export declare class Fib {␊
      [Symbol.iterator](): Iterator<number, void, number>␊
      constructor()␊
    }␊
    ␊
    export declare class Fib2 {␊
      [Symbol.iterator](): Iterator<number, void, number>␊
      static create(seed: number): Fib2␊
    }␊
    ␊
    export declare class Fib3 {␊
      current: number␊
      next: number␊
      constructor(current: number, next: number)␊
      [Symbol.iterator](): Iterator<number, void, number>␊
    }␊
    ␊
    export declare class JsClassForEither {␊
      constructor()␊
    }␊
    ␊
    export declare class JsRemote {␊
      name(): string␊
    }␊
    ␊
    export declare class JsRepo {␊
      constructor(dir: string)␊
      remote(): JsRemote␊
    }␊
    ␊
    export declare class NinjaTurtle {␊
      name: string␊
      static isInstanceOf(value: unknown): boolean␊
      /** Create your ninja turtle! 🐢 */␊
      static newRaph(): NinjaTurtle␊
      getMaskColor(): string␊
      getName(): string␊
      returnThis(this: this): this␊
    }␊
    ␊
    export declare class NotWritableClass {␊
      name: string␊
      constructor(name: string)␊
      setName(name: string): void␊
    }␊
    ␊
    export declare class Optional {␊
      static optionEnd(required: string, optional?: string | undefined | null): string␊
      static optionStart(optional: string | undefined | null, required: string): string␊
      static optionStartEnd(optional1: string | undefined | null, required: string, optional2?: string | undefined | null): string␊
      static optionOnly(optional?: string | undefined | null): string␊
    }␊
    ␊
    export declare class Width {␊
      value: number␊
      constructor(value: number)␊
    }␊
    ␊
    export interface A {␊
      foo: number␊
    }␊
    ␊
    export declare function acceptThreadsafeFunction(func: (err: Error | null, value: number) => any): void␊
    ␊
    export declare function acceptThreadsafeFunctionFatal(func: (value: number) => any): void␊
    ␊
    export declare function acceptThreadsafeFunctionTupleArgs(func: (err: Error | null, arg0: number, arg1: boolean, arg2: string) => any): void␊
    ␊
    export declare function add(a: number, b: number): number␊
    ␊
    export declare const enum ALIAS {␊
      A = 0,␊
      B = 1␊
    }␊
    ␊
    export interface AliasedStruct {␊
      a: ALIAS␊
      b: number␊
    }␊
    ␊
    export interface AllOptionalObject {␊
      name?: string␊
      age?: number␊
    }␊
    ␊
    export declare function appendBuffer(buf: Buffer): Buffer␊
    ␊
    export declare function arrayBufferPassThrough(buf: Uint8Array): Promise<Uint8Array>␊
    ␊
    export declare function asyncMultiTwo(arg: number): Promise<number>␊
    ␊
    export declare function asyncPlus100(p: Promise<number>): Promise<number>␊
    ␊
    export declare function asyncReduceBuffer(buf: Buffer): Promise<number>␊
    ␊
    export interface B {␊
      bar: number␊
    }␊
    ␊
    export declare function bigintAdd(a: bigint, b: bigint): bigint␊
    ␊
    export declare function bigintFromI128(): bigint␊
    ␊
    export declare function bigintFromI64(): bigint␊
    ␊
    export declare function bigintGetU64AsString(bi: bigint): string␊
    ␊
    export declare function bufferPassThrough(buf: Buffer): Promise<Buffer>␊
    ␊
    export interface C {␊
      baz: number␊
    }␊
    ␊
    export declare function callbackReturnPromise<T>(functionInput: () => T | Promise<T>, callback: (err: Error | null, result: T) => void): T | Promise<T>␊
    ␊
    export declare function callThreadsafeFunction(callback: (...args: any[]) => any): void␊
    ␊
    export declare function captureErrorInCallback(cb1: () => void, cb2: (arg0: Error) => void): void␊
    ␊
    export declare function chronoDateAdd1Minute(input: Date): Date␊
    ␊
    export declare function chronoDateToMillis(input: Date): number␊
    ␊
    export declare function concatLatin1(s: string): string␊
    ␊
    export declare function concatStr(s: string): string␊
    ␊
    export declare function concatUtf16(s: string): string␊
    ␊
    export declare function contains(source: string, target: string): boolean␊
    ␊
    export declare function convertU32Array(input: Uint32Array): Array<number>␊
    ␊
    export declare function createBigInt(): bigint␊
    ␊
    export declare function createBigIntI64(): bigint␊
    ␊
    export declare function createExternal(size: number): ExternalObject<number>␊
    ␊
    export declare function createExternalString(content: string): ExternalObject<string>␊
    ␊
    export declare function createExternalTypedArray(): Uint32Array␊
    ␊
    export declare function createObj(): object␊
    ␊
    export declare function createObjectWithClassField(): ObjectFieldClassInstance␊
    ␊
    export declare function createObjWithProperty(): { value: ArrayBuffer, get getter(): number }␊
    ␊
    export declare function createSymbol(): symbol␊
    ␊
    /** You could break the step and for an new continuous value. */␊
    export declare const enum CustomNumEnum {␊
      One = 1,␊
      Two = 2,␊
      Three = 3,␊
      Four = 4,␊
      Six = 6,␊
      Eight = 8,␊
      Nine = 9,␊
      Ten = 10␊
    }␊
    ␊
    export declare function customStatusCode(): void␊
    ␊
    export interface Dates {␊
      start: Date␊
      end?: Date␊
    }␊
    ␊
    export declare function dateToNumber(input: Date): number␊
    ␊
    /** This is a const */␊
    export const DEFAULT_COST: number␊
    ␊
    export declare function derefUint8Array(a: Uint8Array, b: Uint8ClampedArray): number␊
    ␊
    export declare function either3(input: string | number | boolean): number␊
    ␊
    export declare function either4(input: string | number | boolean | Obj): number␊
    ␊
    export declare function eitherBoolOrFunction(input: boolean | ((...args: any[]) => any)): void␊
    ␊
    export declare function eitherFromObjects(input: A | B | C): string␊
    ␊
    export declare function eitherFromOption(): JsClassForEither | undefined␊
    ␊
    export declare function eitherStringOrNumber(input: string | number): number␊
    ␊
    export declare const enum Empty {␊
    ␊
    }␊
    ␊
    export declare function enumToI32(e: CustomNumEnum): number␊
    ␊
    export declare function fibonacci(n: number): number␊
    ␊
    export declare function fnReceivedAliased(s: AliasedStruct, e: ALIAS): void␊
    ␊
    export declare function getBuffer(): Buffer␊
    ␊
    export declare function getCwd(callback: (arg0: string) => void): void␊
    ␊
    export declare function getEmptyBuffer(): Buffer␊
    ␊
    export declare function getExternal(external: ExternalObject<number>): number␊
    ␊
    export declare function getGlobal(): typeof global␊
    ␊
    export declare function getMapping(): Record<string, number>␊
    ␊
    export declare function getNestedNumArr(): number[][][]␊
    ␊
    export declare function getNull(): null␊
    ␊
    export declare function getNumArr(): number[]␊
    ␊
    /** Gets some numbers */␊
    export declare function getNums(): Array<number>␊
    ␊
    export declare function getPackageJsonName(packageJson: PackageJson): string␊
    ␊
    export declare function getStrFromObject(): void␊
    ␊
    export declare function getterFromObj(): number␊
    ␊
    export declare function getUndefined(): void␊
    ␊
    export declare function getWords(): Array<string>␊
    ␊
    /** default enum values are continuos i32s start from 0 */␊
    export declare const enum Kind {␊
      /** Barks */␊
      Dog = 0,␊
      /** Kills birds */␊
      Cat = 1,␊
      /** Tasty */␊
      Duck = 2␊
    }␊
    ␊
    export declare function listObjKeys(obj: object): Array<string>␊
    ␊
    export declare function mapOption(val?: number | undefined | null): number | null␊
    ␊
    export declare function mutateExternal(external: ExternalObject<number>, newVal: number): void␊
    ␊
    export declare function mutateTypedArray(input: Float32Array): void␊
    ␊
    export interface Obj {␊
      v: string | number␊
    }␊
    ␊
    export interface ObjectFieldClassInstance {␊
      bird: Bird␊
    }␊
    ␊
    export interface ObjectOnlyFromJs {␊
      count: number␊
      callback: (err: Error | null, value: number) => any␊
    }␊
    ␊
    export declare function optionEnd(callback: (arg0: string, arg1?: string | undefined | null) => void): void␊
    ␊
    export declare function optionOnly(callback: (arg0?: string | undefined | null) => void): void␊
    ␊
    export declare function optionStart(callback: (arg0: string | undefined | null, arg1: string) => void): void␊
    ␊
    export declare function optionStartEnd(callback: (arg0: string | undefined | null, arg1: string, arg2?: string | undefined | null) => void): void␊
    ␊
    export declare function overrideIndividualArgOnFunction(notOverridden: string, f: () => string, notOverridden2: number): string␊
    ␊
    export declare function overrideIndividualArgOnFunctionWithCbArg(callback: (town: string, name?: string | undefined | null) => string, notOverridden: number): object␊
    ␊
    /** This is an interface for package.json */␊
    export interface PackageJson {␊
      name: string␊
      /** The version of the package */␊
      version: string␊
      dependencies?: Record<string, any>␊
      devDependencies?: Record<string, any>␊
    }␊
    ␊
    export declare function panic(): void␊
    ␊
    export declare function plusOne(this: Width): number␊
    ␊
    export declare function promiseInEither(input: number | Promise<number>): Promise<boolean>␊
    ␊
    /** napi = { version = 2, features = ["serde-json"] } */␊
    export declare function readFile(callback: (arg0: Error | undefined, arg1?: string | undefined | null) => void): void␊
    ␊
    export declare function readFileAsync(path: string): Promise<Buffer>␊
    ␊
    export declare function readPackageJson(): PackageJson␊
    ␊
    export declare function receiveAllOptionalObject(obj?: AllOptionalObject | undefined | null): void␊
    ␊
    export declare function receiveClassOrNumber(either: number | JsClassForEither): number␊
    ␊
    export declare function receiveDifferentClass(either: JsClassForEither | AnotherClassForEither): number␊
    ␊
    export declare function receiveMutClassOrNumber(either: number | JsClassForEither): number␊
    ␊
    export declare function receiveObjectOnlyFromJs(obj: { count: number, callback: (err: Error | null, count: number) => void }): void␊
    ␊
    export declare function receiveObjectWithClassField(object: ObjectFieldClassInstance): Bird␊
    ␊
    export declare function receiveStrictObject(strictObject: StrictObject): void␊
    ␊
    export declare function receiveString(s: string): string␊
    ␊
    export declare function returnEither(input: number): string | number␊
    ␊
    export declare function returnEitherClass(input: number): number | JsClassForEither␊
    ␊
    export declare function returnJsFunction(): (...args: any[]) => any␊
    ␊
    export declare function returnNull(): null␊
    ␊
    export declare function returnUndefined(): void␊
    ␊
    export declare function returnUndefinedIfInvalid(input: boolean): boolean␊
    ␊
    export declare function returnUndefinedIfInvalidPromise(input: Promise<boolean>): Promise<boolean>␊
    ␊
    export declare function roundtripStr(s: string): string␊
    ␊
    export declare function runScript(script: string): unknown␊
    ␊
    export declare function setSymbolInObj(symbol: symbol): object␊
    ␊
    export interface StrictObject {␊
      name: string␊
    }␊
    ␊
    export declare function sumMapping(nums: Record<string, number>): number␊
    ␊
    export declare function sumNums(nums: Array<number>): number␊
    ␊
    export declare function testSerdeRoundtrip(data: any): any␊
    ␊
    export declare function threadsafeFunctionClosureCapture(func: (...args: any[]) => any): void␊
    ␊
    export declare function threadsafeFunctionFatalMode(cb: (...args: any[]) => any): void␊
    ␊
    export declare function threadsafeFunctionFatalModeError(cb: (...args: any[]) => any): void␊
    ␊
    export declare function threadsafeFunctionThrowError(cb: (...args: any[]) => any): void␊
    ␊
    export declare function throwError(): void␊
    ␊
    export declare function toJsObj(): object␊
    ␊
    export declare function tsfnAsyncCall(func: (...args: any[]) => any): Promise<void>␊
    ␊
    export declare function tsfnCallWithCallback(func: (...args: any[]) => any): void␊
    ␊
    export declare function tsRename(a: { foo: number }): string[]␊
    ␊
    export interface TsTypeChanged {␊
      typeOverride: object␊
      typeOverrideOptional?: object␊
    }␊
    ␊
    export declare function validateArray(arr: Array<number>): number␊
    ␊
    export declare function validateBigint(input: bigint): bigint␊
    ␊
    export declare function validateBoolean(i: boolean): boolean␊
    ␊
    export declare function validateBuffer(b: Buffer): number␊
    ␊
    export declare function validateDate(d: Date): number␊
    ␊
    export declare function validateDateTime(d: Date): number␊
    ␊
    export declare function validateExternal(e: ExternalObject<number>): number␊
    ␊
    export declare function validateFunction(cb: () => number): number␊
    ␊
    export declare function validateHashMap(input: Record<string, number>): number␊
    ␊
    export declare function validateNull(i: null): boolean␊
    ␊
    export declare function validateNumber(i: number): number␊
    ␊
    export declare function validateOptional(input1?: string | undefined | null, input2?: boolean | undefined | null): boolean␊
    ␊
    export declare function validatePromise(p: Promise<number>): Promise<number>␊
    ␊
    export declare function validateString(s: string): string␊
    ␊
    export declare function validateSymbol(s: symbol): boolean␊
    ␊
    export declare function validateTypedArray(input: Uint8Array): number␊
    ␊
    export declare function validateUndefined(i: undefined): boolean␊
    ␊
    export declare function withAbortController(a: number, b: number, signal: AbortSignal): Promise<number>␊
    ␊
    export declare function withoutAbortController(a: number, b: number): Promise<number>␊
    ␊
    export declare function xxh64Alias(input: Buffer): bigint␊
    ␊
    export declare namespace xxh2 {␊
      export function xxh2Plus(a: number, b: number): number␊
      export function xxh3Xxh64Alias(input: Buffer): bigint␊
    }␊
    ␊
    export declare namespace xxh3 {␊
      /** Xxh3 class */␊
      export class Xxh3 {␊
        constructor()␊
        /** update */␊
        update(input: Buffer): void␊
        digest(): bigint␊
      }␊
      export const ALIGNMENT: number␊
      /** xxh128 function */␊
      export function xxh128(input: Buffer): bigint␊
      export function xxh3_64(input: Buffer): bigint␊
    }␊
    `

## should process type def with noConstEnum correctly

> Snapshot 1

    `/**␊
     * \`constructor\` option for \`struct\` requires all fields to be public,␊
     * otherwise tag impl fn as constructor␊
     * #[napi(constructor)]␊
     */␊
    export declare class Animal {␊
      /** Kind of animal */␊
      readonly kind: Kind␊
      /** This is the constructor */␊
      constructor(kind: Kind, name: string)␊
      /** This is a factory method */␊
      static withKind(kind: Kind): Animal␊
      get name(): string␊
      set name(name: string)␊
      get type(): Kind␊
      set type(kind: Kind)␊
      /**␊
       * This is a␊
       * multi-line comment␊
       * with an emoji 🚀␊
       */␊
      whoami(): string␊
      /** This is static... */␊
      static getDogKind(): Kind␊
      /**␊
       * Here are some characters and character sequences␊
       * that should be escaped correctly:␊
       * \\[]{}/\\:""{␊
       * }␊
       */␊
      returnOtherClass(): Dog␊
      returnOtherClassWithCustomConstructor(): Bird␊
      overrideIndividualArgOnMethod(normalTy: string, overriddenTy: {n: string}): Bird␊
    }␊
    ␊
    export declare class AnimalWithDefaultConstructor {␊
      name: string␊
      kind: number␊
      constructor(name: string, kind: number)␊
    }␊
    ␊
    export declare class AnotherClassForEither {␊
      constructor()␊
    }␊
    ␊
    export declare class AnotherCssStyleSheet {␊
      get rules(): CssRuleList␊
    }␊
    export type AnotherCSSStyleSheet = AnotherCssStyleSheet␊
    ␊
    export declare class Asset {␊
      constructor()␊
      get filePath(): number␊
    }␊
    export type JsAsset = Asset␊
    ␊
    export declare class Assets {␊
      constructor()␊
      get(id: number): JsAsset | null␊
    }␊
    export type JsAssets = Assets␊
    ␊
    export declare class Bird {␊
      name: string␊
      constructor(name: string)␊
      getCount(): number␊
      getNameAsync(): Promise<string>␊
    }␊
    ␊
    /** Smoking test for type generation */␊
    export declare class Blake2BHasher {␊
      static withKey(key: Blake2bKey): Blake2BHasher␊
      update(data: Buffer): void␊
    }␊
    export type Blake2bHasher = Blake2BHasher␊
    ␊
    export declare class Blake2BKey {␊
    ␊
    }␊
    export type Blake2bKey = Blake2BKey␊
    ␊
    export declare class ClassWithFactory {␊
      name: string␊
      static withName(name: string): ClassWithFactory␊
      setName(name: string): this␊
    }␊
    ␊
    export declare class Context {␊
      maybeNeed?: boolean␊
      buffer: Uint8Array␊
      constructor()␊
      static withData(data: string): Context␊
      static withBuffer(buf: Uint8Array): Context␊
      method(): string␊
    }␊
    ␊
    export declare class CssRuleList {␊
      getRules(): Array<string>␊
      get parentStyleSheet(): CSSStyleSheet␊
      get name(): string | null␊
    }␊
    export type CSSRuleList = CssRuleList␊
    ␊
    export declare class CssStyleSheet {␊
      constructor(name: string, rules: Array<string>)␊
      get rules(): CssRuleList␊
      anotherCssStyleSheet(): AnotherCssStyleSheet␊
    }␊
    export type CSSStyleSheet = CssStyleSheet␊
    ␊
    export declare class CustomFinalize {␊
      constructor(width: number, height: number)␊
    }␊
    ␊
    export declare class Dog {␊
      name: string␊
      constructor(name: string)␊
    }␊
    ␊
    export declare class Fib {␊
      [Symbol.iterator](): Iterator<number, void, number>␊
      constructor()␊
    }␊
    ␊
    export declare class Fib2 {␊
      [Symbol.iterator](): Iterator<number, void, number>␊
      static create(seed: number): Fib2␊
    }␊
    ␊
    export declare class Fib3 {␊
      current: number␊
      next: number␊
      constructor(current: number, next: number)␊
      [Symbol.iterator](): Iterator<number, void, number>␊
    }␊
    ␊
    export declare class JsClassForEither {␊
      constructor()␊
    }␊
    ␊
    export declare class JsRemote {␊
      name(): string␊
    }␊
    ␊
    export declare class JsRepo {␊
      constructor(dir: string)␊
      remote(): JsRemote␊
    }␊
    ␊
    export declare class NinjaTurtle {␊
      name: string␊
      static isInstanceOf(value: unknown): boolean␊
      /** Create your ninja turtle! 🐢 */␊
      static newRaph(): NinjaTurtle␊
      getMaskColor(): string␊
      getName(): string␊
      returnThis(this: this): this␊
    }␊
    ␊
    export declare class NotWritableClass {␊
      name: string␊
      constructor(name: string)␊
      setName(name: string): void␊
    }␊
    ␊
    export declare class Optional {␊
      static optionEnd(required: string, optional?: string | undefined | null): string␊
      static optionStart(optional: string | undefined | null, required: string): string␊
      static optionStartEnd(optional1: string | undefined | null, required: string, optional2?: string | undefined | null): string␊
      static optionOnly(optional?: string | undefined | null): string␊
    }␊
    ␊
    export declare class Width {␊
      value: number␊
      constructor(value: number)␊
    }␊
    ␊
    export interface A {␊
      foo: number␊
    }␊
    ␊
    export declare function acceptThreadsafeFunction(func: (err: Error | null, value: number) => any): void␊
    ␊
    export declare function acceptThreadsafeFunctionFatal(func: (value: number) => any): void␊
    ␊
    export declare function acceptThreadsafeFunctionTupleArgs(func: (err: Error | null, arg0: number, arg1: boolean, arg2: string) => any): void␊
    ␊
    export declare function add(a: number, b: number): number␊
    ␊
    export declare enum ALIAS {␊
      A = 0,␊
      B = 1␊
    }␊
    ␊
    export interface AliasedStruct {␊
      a: ALIAS␊
      b: number␊
    }␊
    ␊
    export interface AllOptionalObject {␊
      name?: string␊
      age?: number␊
    }␊
    ␊
    export declare function appendBuffer(buf: Buffer): Buffer␊
    ␊
    export declare function arrayBufferPassThrough(buf: Uint8Array): Promise<Uint8Array>␊
    ␊
    export declare function asyncMultiTwo(arg: number): Promise<number>␊
    ␊
    export declare function asyncPlus100(p: Promise<number>): Promise<number>␊
    ␊
    export declare function asyncReduceBuffer(buf: Buffer): Promise<number>␊
    ␊
    export interface B {␊
      bar: number␊
    }␊
    ␊
    export declare function bigintAdd(a: bigint, b: bigint): bigint␊
    ␊
    export declare function bigintFromI128(): bigint␊
    ␊
    export declare function bigintFromI64(): bigint␊
    ␊
    export declare function bigintGetU64AsString(bi: bigint): string␊
    ␊
    export declare function bufferPassThrough(buf: Buffer): Promise<Buffer>␊
    ␊
    export interface C {␊
      baz: number␊
    }␊
    ␊
    export declare function callbackReturnPromise<T>(functionInput: () => T | Promise<T>, callback: (err: Error | null, result: T) => void): T | Promise<T>␊
    ␊
    export declare function callThreadsafeFunction(callback: (...args: any[]) => any): void␊
    ␊
    export declare function captureErrorInCallback(cb1: () => void, cb2: (arg0: Error) => void): void␊
    ␊
    export declare function chronoDateAdd1Minute(input: Date): Date␊
    ␊
    export declare function chronoDateToMillis(input: Date): number␊
    ␊
    export declare function concatLatin1(s: string): string␊
    ␊
    export declare function concatStr(s: string): string␊
    ␊
    export declare function concatUtf16(s: string): string␊
    ␊
    export declare function contains(source: string, target: string): boolean␊
    ␊
    export declare function convertU32Array(input: Uint32Array): Array<number>␊
    ␊
    export declare function createBigInt(): bigint␊
    ␊
    export declare function createBigIntI64(): bigint␊
    ␊
    export declare function createExternal(size: number): ExternalObject<number>␊
    ␊
    export declare function createExternalString(content: string): ExternalObject<string>␊
    ␊
    export declare function createExternalTypedArray(): Uint32Array␊
    ␊
    export declare function createObj(): object␊
    ␊
    export declare function createObjectWithClassField(): ObjectFieldClassInstance␊
    ␊
    export declare function createObjWithProperty(): { value: ArrayBuffer, get getter(): number }␊
    ␊
    export declare function createSymbol(): symbol␊
    ␊
    /** You could break the step and for an new continuous value. */␊
    export declare enum CustomNumEnum {␊
      One = 1,␊
      Two = 2,␊
      Three = 3,␊
      Four = 4,␊
      Six = 6,␊
      Eight = 8,␊
      Nine = 9,␊
      Ten = 10␊
    }␊
    ␊
    export declare function customStatusCode(): void␊
    ␊
    export interface Dates {␊
      start: Date␊
      end?: Date␊
    }␊
    ␊
    export declare function dateToNumber(input: Date): number␊
    ␊
    /** This is a const */␊
    export const DEFAULT_COST: number␊
    ␊
    export declare function derefUint8Array(a: Uint8Array, b: Uint8ClampedArray): number␊
    ␊
    export declare function either3(input: string | number | boolean): number␊
    ␊
    export declare function either4(input: string | number | boolean | Obj): number␊
    ␊
    export declare function eitherBoolOrFunction(input: boolean | ((...args: any[]) => any)): void␊
    ␊
    export declare function eitherFromObjects(input: A | B | C): string␊
    ␊
    export declare function eitherFromOption(): JsClassForEither | undefined␊
    ␊
    export declare function eitherStringOrNumber(input: string | number): number␊
    ␊
    export declare enum Empty {␊
    ␊
    }␊
    ␊
    export declare function enumToI32(e: CustomNumEnum): number␊
    ␊
    export declare function fibonacci(n: number): number␊
    ␊
    export declare function fnReceivedAliased(s: AliasedStruct, e: ALIAS): void␊
    ␊
    export declare function getBuffer(): Buffer␊
    ␊
    export declare function getCwd(callback: (arg0: string) => void): void␊
    ␊
    export declare function getEmptyBuffer(): Buffer␊
    ␊
    export declare function getExternal(external: ExternalObject<number>): number␊
    ␊
    export declare function getGlobal(): typeof global␊
    ␊
    export declare function getMapping(): Record<string, number>␊
    ␊
    export declare function getNestedNumArr(): number[][][]␊
    ␊
    export declare function getNull(): null␊
    ␊
    export declare function getNumArr(): number[]␊
    ␊
    /** Gets some numbers */␊
    export declare function getNums(): Array<number>␊
    ␊
    export declare function getPackageJsonName(packageJson: PackageJson): string␊
    ␊
    export declare function getStrFromObject(): void␊
    ␊
    export declare function getterFromObj(): number␊
    ␊
    export declare function getUndefined(): void␊
    ␊
    export declare function getWords(): Array<string>␊
    ␊
    /** default enum values are continuos i32s start from 0 */␊
    export declare enum Kind {␊
      /** Barks */␊
      Dog = 0,␊
      /** Kills birds */␊
      Cat = 1,␊
      /** Tasty */␊
      Duck = 2␊
    }␊
    ␊
    export declare function listObjKeys(obj: object): Array<string>␊
    ␊
    export declare function mapOption(val?: number | undefined | null): number | null␊
    ␊
    export declare function mutateExternal(external: ExternalObject<number>, newVal: number): void␊
    ␊
    export declare function mutateTypedArray(input: Float32Array): void␊
    ␊
    export interface Obj {␊
      v: string | number␊
    }␊
    ␊
    export interface ObjectFieldClassInstance {␊
      bird: Bird␊
    }␊
    ␊
    export interface ObjectOnlyFromJs {␊
      count: number␊
      callback: (err: Error | null, value: number) => any␊
    }␊
    ␊
    export declare function optionEnd(callback: (arg0: string, arg1?: string | undefined | null) => void): void␊
    ␊
    export declare function optionOnly(callback: (arg0?: string | undefined | null) => void): void␊
    ␊
    export declare function optionStart(callback: (arg0: string | undefined | null, arg1: string) => void): void␊
    ␊
    export declare function optionStartEnd(callback: (arg0: string | undefined | null, arg1: string, arg2?: string | undefined | null) => void): void␊
    ␊
    export declare function overrideIndividualArgOnFunction(notOverridden: string, f: () => string, notOverridden2: number): string␊
    ␊
    export declare function overrideIndividualArgOnFunctionWithCbArg(callback: (town: string, name?: string | undefined | null) => string, notOverridden: number): object␊
    ␊
    /** This is an interface for package.json */␊
    export interface PackageJson {␊
      name: string␊
      /** The version of the package */␊
      version: string␊
      dependencies?: Record<string, any>␊
      devDependencies?: Record<string, any>␊
    }␊
    ␊
    export declare function panic(): void␊
    ␊
    export declare function plusOne(this: Width): number␊
    ␊
    export declare function promiseInEither(input: number | Promise<number>): Promise<boolean>␊
    ␊
    /** napi = { version = 2, features = ["serde-json"] } */␊
    export declare function readFile(callback: (arg0: Error | undefined, arg1?: string | undefined | null) => void): void␊
    ␊
    export declare function readFileAsync(path: string): Promise<Buffer>␊
    ␊
    export declare function readPackageJson(): PackageJson␊
    ␊
    export declare function receiveAllOptionalObject(obj?: AllOptionalObject | undefined | null): void␊
    ␊
    export declare function receiveClassOrNumber(either: number | JsClassForEither): number␊
    ␊
    export declare function receiveDifferentClass(either: JsClassForEither | AnotherClassForEither): number␊
    ␊
    export declare function receiveMutClassOrNumber(either: number | JsClassForEither): number␊
    ␊
    export declare function receiveObjectOnlyFromJs(obj: { count: number, callback: (err: Error | null, count: number) => void }): void␊
    ␊
    export declare function receiveObjectWithClassField(object: ObjectFieldClassInstance): Bird␊
    ␊
    export declare function receiveStrictObject(strictObject: StrictObject): void␊
    ␊
    export declare function receiveString(s: string): string␊
    ␊
    export declare function returnEither(input: number): string | number␊
    ␊
    export declare function returnEitherClass(input: number): number | JsClassForEither␊
    ␊
    export declare function returnJsFunction(): (...args: any[]) => any␊
    ␊
    export declare function returnNull(): null␊
    ␊
    export declare function returnUndefined(): void␊
    ␊
    export declare function returnUndefinedIfInvalid(input: boolean): boolean␊
    ␊
    export declare function returnUndefinedIfInvalidPromise(input: Promise<boolean>): Promise<boolean>␊
    ␊
    export declare function roundtripStr(s: string): string␊
    ␊
    export declare function runScript(script: string): unknown␊
    ␊
    export declare function setSymbolInObj(symbol: symbol): object␊
    ␊
    export interface StrictObject {␊
      name: string␊
    }␊
    ␊
    export declare function sumMapping(nums: Record<string, number>): number␊
    ␊
    export declare function sumNums(nums: Array<number>): number␊
    ␊
    export declare function testSerdeRoundtrip(data: any): any␊
    ␊
    export declare function threadsafeFunctionClosureCapture(func: (...args: any[]) => any): void␊
    ␊
    export declare function threadsafeFunctionFatalMode(cb: (...args: any[]) => any): void␊
    ␊
    export declare function threadsafeFunctionFatalModeError(cb: (...args: any[]) => any): void␊
    ␊
    export declare function threadsafeFunctionThrowError(cb: (...args: any[]) => any): void␊
    ␊
    export declare function throwError(): void␊
    ␊
    export declare function toJsObj(): object␊
    ␊
    export declare function tsfnAsyncCall(func: (...args: any[]) => any): Promise<void>␊
    ␊
    export declare function tsfnCallWithCallback(func: (...args: any[]) => any): void␊
    ␊
    export declare function tsRename(a: { foo: number }): string[]␊
    ␊
    export interface TsTypeChanged {␊
      typeOverride: object␊
      typeOverrideOptional?: object␊
    }␊
    ␊
    export declare function validateArray(arr: Array<number>): number␊
    ␊
    export declare function validateBigint(input: bigint): bigint␊
    ␊
    export declare function validateBoolean(i: boolean): boolean␊
    ␊
    export declare function validateBuffer(b: Buffer): number␊
    ␊
    export declare function validateDate(d: Date): number␊
    ␊
    export declare function validateDateTime(d: Date): number␊
    ␊
    export declare function validateExternal(e: ExternalObject<number>): number␊
    ␊
    export declare function validateFunction(cb: () => number): number␊
    ␊
    export declare function validateHashMap(input: Record<string, number>): number␊
    ␊
    export declare function validateNull(i: null): boolean␊
    ␊
    export declare function validateNumber(i: number): number␊
    ␊
    export declare function validateOptional(input1?: string | undefined | null, input2?: boolean | undefined | null): boolean␊
    ␊
    export declare function validatePromise(p: Promise<number>): Promise<number>␊
    ␊
    export declare function validateString(s: string): string␊
    ␊
    export declare function validateSymbol(s: symbol): boolean␊
    ␊
    export declare function validateTypedArray(input: Uint8Array): number␊
    ␊
    export declare function validateUndefined(i: undefined): boolean␊
    ␊
    export declare function withAbortController(a: number, b: number, signal: AbortSignal): Promise<number>␊
    ␊
    export declare function withoutAbortController(a: number, b: number): Promise<number>␊
    ␊
    export declare function xxh64Alias(input: Buffer): bigint␊
    ␊
    export declare namespace xxh2 {␊
      export function xxh2Plus(a: number, b: number): number␊
      export function xxh3Xxh64Alias(input: Buffer): bigint␊
    }␊
    ␊
    export declare namespace xxh3 {␊
      /** Xxh3 class */␊
      export class Xxh3 {␊
        constructor()␊
        /** update */␊
        update(input: Buffer): void␊
        digest(): bigint␊
      }␊
      export const ALIGNMENT: number␊
      /** xxh128 function */␊
      export function xxh128(input: Buffer): bigint␊
      export function xxh3_64(input: Buffer): bigint␊
    }␊
    `
