/** Injection token for the shared `TronWeb` instance. */
export const TRON_WEB = Symbol('TRON_WEB');

/**
 * Injection token for the non-secret module options (`TronModuleRuntimeOptions`).
 * The private key and HTTP headers are not stored on this object.
 */
export const TRON_MODULE_OPTIONS = Symbol('TRON_MODULE_OPTIONS');

/** Raw options, including secrets. Not exported from the package entrypoint. */
export const TRON_RAW_OPTIONS = Symbol('TRON_RAW_OPTIONS');

/** 100 TRX, expressed in sun. Enough for a typical TRC-20 transfer. */
export const DEFAULT_FEE_LIMIT_SUN = 100_000_000;

/**
 * Minimal TRC-20 ABI. Declared `as const` so TronWeb 6.4+ `read` / `write`
 * namespaces keep `balanceOf` and `transfer` typed.
 */
export const TRC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    constant: true,
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    payable: false,
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
