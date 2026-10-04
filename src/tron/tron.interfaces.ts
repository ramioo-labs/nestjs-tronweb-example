import { InjectionToken, ModuleMetadata } from '@nestjs/common';

export type TronErrorKind =
  | 'invalid_address'
  | 'invalid_amount'
  | 'contract_revert'
  | 'node_or_network'
  | 'configuration';

export interface TronWebModuleOptions {
  /** Tron full-node HTTP endpoint, for example `https://api.shasta.trongrid.io`. */
  fullHost: string;
  /** Optional HTTP headers. TronGrid keys belong here as `TRON-PRO-API-KEY`. */
  headers?: Record<string, string>;
  /**
   * 64-character hex signing key. Required for `transferTrc20`.
   * Omit it for read-only balance checks.
   */
  privateKey?: string;
  /**
   * Base58 address used as the client default when `privateKey` is omitted.
   * Do not set this together with `privateKey`; the key's address is the signer.
   */
  defaultAddress?: string;
  /** Used when a call does not pass its own contract address. */
  defaultTrc20Contract?: string;
  /** Fee limit in sun for transfers. Defaults to 100_000_000 (100 TRX). */
  feeLimit?: number;
}

export interface TronWebModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (...args: any[]) => TronWebModuleOptions | Promise<TronWebModuleOptions>;
  inject?: InjectionToken[];
}

/** Non-secret view of module options. Safe to log. */
export interface TronModuleRuntimeOptions {
  fullHost: string;
  defaultAddress?: string;
  defaultTrc20Contract?: string;
  feeLimit: number;
  hasPrivateKey: boolean;
}

export interface Trc20Balance {
  contractAddress: string;
  owner: string;
  /** Smallest token units (uint256), never a decimal token amount. */
  amount: string;
}

export interface Trc20TransferParams {
  to: string;
  /** Smallest token units, as a base-10 integer string or bigint. */
  amount: string | bigint;
  contractAddress?: string;
  /** Fee limit in sun. Defaults to the module `feeLimit`. */
  feeLimit?: number;
}

export interface Trc20TransferResult {
  txId: string;
  contractAddress: string;
  from: string;
  to: string;
  /** Smallest token units. */
  amount: string;
}

export interface SanitizedCause {
  name?: string;
  message: string;
  code?: string;
  status?: number;
}
