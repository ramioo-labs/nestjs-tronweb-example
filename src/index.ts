export { TronWebModule, createTronWebClient, toRuntimeOptions } from './tron/tron.module';
export { TronService } from './tron/tron.service';
export { TronCallError, classifyTronError, findTronCallError } from './tron/tron.errors';
export { TRON_WEB, TRON_MODULE_OPTIONS, DEFAULT_FEE_LIMIT_SUN } from './tron/tron.constants';
export type { TronWeb } from 'tronweb';
export type {
  TronWebModuleOptions,
  TronWebModuleAsyncOptions,
  TronModuleRuntimeOptions,
  Trc20Balance,
  Trc20TransferParams,
  Trc20TransferResult,
  TronErrorKind,
  SanitizedCause,
} from './tron/tron.interfaces';
