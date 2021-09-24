export function getWords(): Array<string>
export function getNums(): Array<number>
export function sumNums(nums: Array<number>): number
export function getCwd(callback: (arg0: string) => void): void
export function readFile(callback: (arg0: Error | null, arg1: string | undefined) => void): void
export enum Kind { Dog = 0, Cat = 1, Duck = 2 }
export enum CustomNumEnum { One = 1, Two = 2, Three = 3, Four = 4, Six = 6, Eight = 8, Nine = 9, Ten = 10 }
export function enumToI32(e: CustomNumEnum): number
export function mapOption(val: number | undefined): number | undefined
export function add(a: number, b: number): number
export function fibonacci(n: number): number
export function listObjKeys(obj: object): Array<string>
export function createObj(): object
export function contains(source: string, target: string): boolean
export function concatStr(mutS: string): string
export function concatUtf16(s: Utf16String): Utf16String
export function concatLatin1(s: Latin1String): string
export class Animal {
  readonly kind: Kind
  name: string
  constructor(kind: Kind, name: string)
  static new(kind: Kind, name: string): Animal
  whoami(): string
}
