import { Module } from '@nestjs/common';
import { TronWebModule } from '../index';
import { DemoService } from './demo.service';

@Module({
  imports: [
    TronWebModule.forRootAsync({
      useFactory: () => ({
        fullHost: process.env.TRON_FULL_HOST || 'https://api.shasta.trongrid.io',
        headers: process.env.TRON_API_KEY
          ? { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY }
          : undefined,
        privateKey: process.env.TRON_PRIVATE_KEY || undefined,
        defaultAddress: process.env.TRON_DEFAULT_ADDRESS || undefined,
        defaultTrc20Contract: process.env.TRC20_CONTRACT || undefined,
      }),
    }),
  ],
  providers: [DemoService],
})
export class AppModule {}
