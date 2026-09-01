export type Address = `0x${string}`;
export type Hex = `0x${string}`;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

export function assertAddress(value: unknown, label = "address"): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(label + " must be a 20-byte 0x-prefixed address");
  }
}

export function assertHex(value: unknown, label = "hex value"): asserts value is Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new TypeError(label + " must be even-length 0x-prefixed hexadecimal");
  }
}

export function assertUint64(value: bigint, label: string): void {
  if (value < 0n || value > UINT64_MAX) {
    throw new RangeError(label + " must fit uint64");
  }
}

export function assertUint256(value: bigint, label: string): void {
  if (value < 0n || value > UINT256_MAX) {
    throw new RangeError(label + " must fit uint256");
  }
}

export function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
