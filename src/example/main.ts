import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { findTronCallError } from '../tron/tron.errors';
import { AppModule } from './app.module';
import { DemoService } from './demo.service';
import { loadLocalEnv } from './load-env';

async function bootstrap(): Promise<void> {
  loadLocalEnv();
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    await app.get(DemoService).run();
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  const tronError = findTronCallError(error);
  if (tronError) {
    console.error(`TronCallError kind=${tronError.kind} message=${tronError.message}`);
    if (tronError.detail?.message) {
      console.error(`detail=${tronError.detail.message}`);
    }
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
