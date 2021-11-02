export function getWords(): Array<string>
export function getNums(): Array<number>
export function sumNums(nums: Array<number>): number
export function readFileAsync(path: string): Promise<Buffer>
export function getCwd(callback: (arg0: string) => void): void
export function readFile(callback: (arg0: Error | undefined, arg1: string | null) => void): void
export function eitherStringOrNumber(input: string | number): number
export function returnEither(input: number): string | number
export function either3(input: string | number | boolean): number
interface Obj {
  v: string | number
}
export function either4(input: string | number | boolean | Obj): number
export enum Kind { Dog = 0, Cat = 1, Duck = 2 }
export enum CustomNumEnum { One = 1, Two = 2, Three = 3, Four = 4, Six = 6, Eight = 8, Nine = 9, Ten = 10 }
export function enumToI32(e: CustomNumEnum): number
export function throwError(): void
export function mapOption(val: number | null): number | null
export function add(a: number, b: number): number
export function fibonacci(n: number): number
export function listObjKeys(obj: object): Array<string>
export function createObj(): object
interface PackageJson {
  name: string
  version: string
  dependencies: Record<string, any> | null
  devDependencies: Record<string, any> | null
}
export function readPackageJson(): PackageJson
export function getPackageJsonName(packageJson: PackageJson): string
export function contains(source: string, target: string): boolean
export function concatStr(mutS: string): string
export function concatUtf16(s: string): string
export function concatLatin1(s: string): string
export function withoutAbortController(a: number, b: number): Promise<number>
export function withAbortController(a: number, b: number, ctrl: AbortController): Promise<number>
export function getBuffer(): Buffer
export class Animal {
  readonly kind: Kind
  constructor(kind: Kind, name: string)
  get name(): string
  set name(name: string)
  whoami(): string
  static getDogKind(): Kind
}
