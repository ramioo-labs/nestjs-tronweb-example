import { Inject, Injectable } from '@nestjs/common';
import { TronWeb } from 'tronweb';
import { DEFAULT_FEE_LIMIT_SUN, TRC20_ABI, TRON_MODULE_OPTIONS, TRON_WEB } from './tron.constants';
import {
  assertFeeLimitSun,
  assertTronAddress,
  classifyTronError,
  integerStringFromChainValue,
  parseTokenAmount,
  TronCallError,
} from './tron.errors';
import { Trc20Balance, Trc20TransferParams, Trc20TransferResult, TronModuleRuntimeOptions } from './tron.interfaces';

@Injectable()
export class TronService {
  constructor(
    @Inject(TRON_WEB) private readonly tronWeb: TronWeb,
    @Inject(TRON_MODULE_OPTIONS) private readonly options: TronModuleRuntimeOptions,
  ) {}

  /** Escape hatch for calls this wrapper does not model. Avoid logging the client; it holds the signing key. */
  getClient(): TronWeb {
    return this.tronWeb;
  }

  async getTrc20Balance(owner: string, contractAddress?: string): Promise<Trc20Balance> {
    try {
      const contract = this.contractAddress(contractAddress);
      assertTronAddress(this.tronWeb, owner, 'owner');
      assertTronAddress(this.tronWeb, contract, 'contractAddress');
      const instance = this.tronWeb.contract(TRC20_ABI, contract);
      const raw: unknown = await instance.read.balanceOf([owner], { from: owner });
      const amount = integerStringFromChainValue(raw);
      if (amount === undefined) {
        throw new TronCallError('contract_revert', 'balanceOf returned an unexpected value');
      }
      return { contractAddress: contract, owner, amount };
    } catch (error) {
      throw classifyTronError(error, this.signingSecret());
    }
  }

  async transferTrc20(params: Trc20TransferParams): Promise<Trc20TransferResult> {
    try {
      const contract = this.contractAddress(params.contractAddress);
      assertTronAddress(this.tronWeb, params.to, 'to');
      assertTronAddress(this.tronWeb, contract, 'contractAddress');
      const amount = parseTokenAmount(params.amount);
      const from = this.signerAddress();
      const feeLimit = this.feeLimit(params.feeLimit);
      const instance = this.tronWeb.contract(TRC20_ABI, contract);
      // `account` on contract.write is a private key, not an address. The module key signs.
      const txId = await instance.write.transfer([params.to, BigInt(amount)], { feeLimit });
      if (typeof txId !== 'string' || !/^[0-9a-fA-F]{64}$/.test(txId)) {
        throw new TronCallError('contract_revert', 'Transfer did not return a transaction id');
      }
      return { txId, contractAddress: contract, from, to: params.to, amount };
    } catch (error) {
      throw classifyTronError(error, this.signingSecret());
    }
  }

  private contractAddress(explicit?: string): string {
    const address = explicit?.trim() || this.options.defaultTrc20Contract;
    if (!address) {
      throw new TronCallError(
        'configuration',
        'TRC-20 contract address is required. Pass contractAddress or set defaultTrc20Contract.',
      );
    }
    return address;
  }

  private signerAddress(): string {
    const from = this.tronWeb.defaultAddress?.base58;
    if (!this.options.hasPrivateKey || !this.tronWeb.defaultPrivateKey || typeof from !== 'string' || from.length === 0) {
      throw new TronCallError(
        'configuration',
        'A privateKey is required to transfer TRC-20 tokens. Set it in TronWebModule options.',
      );
    }
    return from;
  }

  private feeLimit(override?: number): number {
    if (override === undefined) {
      return assertFeeLimitSun(this.options.feeLimit ?? DEFAULT_FEE_LIMIT_SUN);
    }
    return assertFeeLimitSun(override);
  }

  private signingSecret(): string | undefined {
    return typeof this.tronWeb.defaultPrivateKey === 'string' ? this.tronWeb.defaultPrivateKey : undefined;
  }
}
