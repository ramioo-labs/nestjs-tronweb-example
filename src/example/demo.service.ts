import { Injectable, Logger } from '@nestjs/common';
import { TronCallError } from '../tron/tron.errors';
import { TronService } from '../tron/tron.service';

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(private readonly tron: TronService) {}

  async run(): Promise<void> {
    const owner = process.env.TRON_OWNER_ADDRESS?.trim();
    const contract = process.env.TRC20_CONTRACT?.trim() || undefined;

    if (!owner) {
      this.logger.log('TRON_OWNER_ADDRESS is unset, so no live TRC-20 call was made.');
      this.logger.log('Copy .env.example to .env and set public addresses to read a balance.');
      return;
    }

    const balance = await this.tron.getTrc20Balance(owner, contract);
    this.logger.log(
      `TRC-20 balance owner=${balance.owner} contract=${balance.contractAddress} amount=${balance.amount} (smallest units)`,
    );

    if (process.env.TRON_DEMO_TRANSFER !== 'true') {
      this.logger.log('TRON_DEMO_TRANSFER is not true, so no transfer was broadcast.');
      return;
    }

    const to = process.env.TRON_TRANSFER_TO?.trim();
    const amount = process.env.TRON_TRANSFER_AMOUNT?.trim();
    if (!to || !amount) {
      throw new TronCallError(
        'configuration',
        'TRON_DEMO_TRANSFER=true requires TRON_TRANSFER_TO and TRON_TRANSFER_AMOUNT (smallest units)',
      );
    }

    const sent = await this.tron.transferTrc20({ to, amount, contractAddress: contract });
    this.logger.log(
      `TRC-20 transfer txId=${sent.txId} from=${sent.from} to=${sent.to} amount=${sent.amount} contract=${sent.contractAddress}`,
    );
  }
}
