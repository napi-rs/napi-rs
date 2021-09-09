export function add(a: number, b: number): number
export function getWords(): Array<string>
export function getNums(): Array<number>
export function logNums(nums: Array<number>): void
export function getCwd(callback: (arg0: string) => void): void
export enum Kind { Dog = 0, Cat = 1, Duck = 2 }
export enum CustomNumEnum { One = 1, Two = 2, Three = 3, Four = 4, Six = 6, Eight = 8, Nine = 9, Ten = 10 }
export function add(a: number, b: number): number
export function fibonacci(n: number): number
export function logKeys(obj: object): void
export function createEmptyObj(): object
export function contains(source: string, target: string): boolean
export class Animal {
  readonly kind: Kind
  name: string
  constructor(kind: Kind, name: string)
  static new(kind: Kind, name: string): Animal
  whoami(): string
}
