import { DynamicModule, Module, Provider } from '@nestjs/common';
import { TronWeb } from 'tronweb';
import {
  DEFAULT_FEE_LIMIT_SUN,
  TRON_MODULE_OPTIONS,
  TRON_RAW_OPTIONS,
  TRON_WEB,
} from './tron.constants';
import { assertFeeLimitSun, TronCallError } from './tron.errors';
import {
  TronModuleRuntimeOptions,
  TronWebModuleAsyncOptions,
  TronWebModuleOptions,
} from './tron.interfaces';
import { TronService } from './tron.service';

interface NormalizedTronWebModuleOptions {
  fullHost: string;
  headers?: Record<string, string>;
  privateKey?: string;
  defaultAddress?: string;
  defaultTrc20Contract?: string;
  feeLimit: number;
}

export function normalizeModuleOptions(options: TronWebModuleOptions): NormalizedTronWebModuleOptions {
  if (!options || typeof options !== 'object') {
    throw new TronCallError('configuration', 'TronWebModule options are required');
  }

  const fullHost = parseFullHost(options.fullHost);
  const headers = parseHeaders(options.headers);
  const privateKey = parsePrivateKey(options.privateKey);
  const defaultAddress = optionalTrimmed(options.defaultAddress, 'defaultAddress');
  const defaultTrc20Contract = optionalTrimmed(options.defaultTrc20Contract, 'defaultTrc20Contract');

  if (privateKey && defaultAddress) {
    throw new TronCallError(
      'configuration',
      'Set privateKey or defaultAddress, not both. The signing key supplies the client address.',
    );
  }

  return {
    fullHost,
    ...(headers ? { headers } : {}),
    ...(privateKey ? { privateKey } : {}),
    ...(defaultAddress ? { defaultAddress } : {}),
    ...(defaultTrc20Contract ? { defaultTrc20Contract } : {}),
    feeLimit: options.feeLimit === undefined ? DEFAULT_FEE_LIMIT_SUN : assertFeeLimitSun(options.feeLimit),
  };
}

/** Drop secrets before the options object is registered for injection. */
export function toRuntimeOptions(options: TronWebModuleOptions): TronModuleRuntimeOptions {
  const normalized = normalizeModuleOptions(options);
  return {
    fullHost: normalized.fullHost,
    feeLimit: normalized.feeLimit,
    hasPrivateKey: normalized.privateKey !== undefined,
    ...(normalized.defaultAddress ? { defaultAddress: normalized.defaultAddress } : {}),
    ...(normalized.defaultTrc20Contract ? { defaultTrc20Contract: normalized.defaultTrc20Contract } : {}),
  };
}

export function createTronWebClient(options: TronWebModuleOptions): TronWeb {
  const normalized = normalizeModuleOptions(options);
  let client: TronWeb;
  try {
    client = new TronWeb({
      fullHost: normalized.fullHost,
      ...(normalized.headers ? { headers: normalized.headers } : {}),
      ...(normalized.privateKey ? { privateKey: normalized.privateKey } : {}),
    });
  } catch (error) {
    throw new TronCallError('configuration', 'Failed to create the TronWeb client from module options', {
      cause: error,
      secret: normalized.privateKey,
    });
  }

  if (normalized.defaultAddress) {
    if (!client.isAddress(normalized.defaultAddress)) {
      throw new TronCallError('configuration', 'defaultAddress is not a valid TRON address');
    }
    client.setAddress(normalized.defaultAddress);
  }

  if (normalized.defaultTrc20Contract && !client.isAddress(normalized.defaultTrc20Contract)) {
    throw new TronCallError('configuration', 'defaultTrc20Contract is not a valid TRON address');
  }

  return client;
}

@Module({})
export class TronWebModule {
  static forRoot(options: TronWebModuleOptions): DynamicModule {
    return TronWebModule.register({
      provide: TRON_RAW_OPTIONS,
      useValue: options,
    });
  }

  static forRootAsync(options: TronWebModuleAsyncOptions): DynamicModule {
    return TronWebModule.register(
      {
        provide: TRON_RAW_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      options.imports ?? [],
    );
  }

  private static register(rawProvider: Provider, imports: DynamicModule['imports'] = []): DynamicModule {
    return {
      module: TronWebModule,
      global: true,
      imports,
      providers: [
        rawProvider,
        {
          provide: TRON_WEB,
          useFactory: (raw: TronWebModuleOptions) => createTronWebClient(raw),
          inject: [TRON_RAW_OPTIONS],
        },
        {
          provide: TRON_MODULE_OPTIONS,
          useFactory: (raw: TronWebModuleOptions) => toRuntimeOptions(raw),
          inject: [TRON_RAW_OPTIONS],
        },
        TronService,
      ],
      exports: [TronService, TRON_WEB, TRON_MODULE_OPTIONS],
    };
  }
}

function parseFullHost(fullHost: unknown): string {
  if (typeof fullHost !== 'string' || fullHost.trim() === '') {
    throw new TronCallError('configuration', 'fullHost is required and must be an absolute http(s) URL');
  }
  let url: URL;
  try {
    url = new URL(fullHost.trim());
  } catch {
    throw new TronCallError('configuration', 'fullHost is required and must be an absolute http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TronCallError('configuration', 'fullHost must use http or https');
  }
  if (url.username || url.password) {
    throw new TronCallError(
      'configuration',
      'fullHost must not include URL credentials. Pass API keys via the headers option.',
    );
  }
  return fullHost.trim();
}

function parseHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new TronCallError('configuration', 'headers must be a map of string keys to string values');
  }
  const parsed: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'string' || key.trim() === '') {
      throw new TronCallError('configuration', 'headers must be a map of string keys to string values');
    }
    parsed[key] = value;
  }
  return parsed;
}

function parsePrivateKey(privateKey: string | undefined): string | undefined {
  if (privateKey === undefined || privateKey === '') return undefined;
  if (typeof privateKey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new TronCallError('configuration', 'privateKey must be a 64-character hex string when set');
  }
  return privateKey;
}

function optionalTrimmed(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TronCallError('configuration', `${label} must be a non-empty string when set`);
  }
  return value.trim();
}
