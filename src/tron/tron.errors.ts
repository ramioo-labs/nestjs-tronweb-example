import {
  SanitizedCause,
  TronErrorKind,
} from './tron.interfaces';

const MAX_DETAIL_LENGTH = 500;

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNABORTED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export class TronCallError extends Error {
  readonly kind: TronErrorKind;
  /** Sanitized node or cause summary. Secrets passed to the constructor are removed. */
  readonly detail?: SanitizedCause;

  constructor(
    kind: TronErrorKind,
    message: string,
    options?: { cause?: unknown; secret?: string; detail?: SanitizedCause },
  ) {
    const secret = options?.secret;
    const detail = options?.detail ?? (options?.cause === undefined ? undefined : sanitizeCause(options.cause, secret));
    const safeMessage = clip(redact(message, secret));
    super(safeMessage, detail ? { cause: detail } : undefined);
    this.name = 'TronCallError';
    this.kind = kind;
    this.detail = detail;
  }
}

export function redact(message: string, secret?: string): string {
  if (!secret || secret.length < 8 || !message) {
    return message;
  }
  const variants = new Set([secret, secret.toLowerCase(), secret.toUpperCase(), `0x${secret}`, `0x${secret.toLowerCase()}`]);
  let next = message;
  for (const variant of variants) {
    if (variant.length < 8) continue;
    next = next.split(variant).join('[redacted]');
  }
  return next;
}

export function parseTokenAmount(amount: string | bigint): string {
  if (typeof amount === 'bigint') {
    if (amount < 0n) {
      throw new TronCallError('invalid_amount', 'Amount must be a non-negative integer in smallest token units');
    }
    return amount.toString();
  }
  if (typeof amount !== 'string' || !/^(0|[1-9]\d*)$/.test(amount)) {
    throw new TronCallError(
      'invalid_amount',
      'Amount must be a base-10 integer string or bigint in smallest token units',
    );
  }
  return amount;
}

export function assertFeeLimitSun(value: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TronCallError('configuration', 'feeLimit must be a positive integer number of sun');
  }
  return value;
}

export function assertTronAddress(
  tronWeb: { isAddress(address?: unknown): boolean },
  address: unknown,
  label: string,
): asserts address is string {
  if (typeof address !== 'string' || !tronWeb.isAddress(address)) {
    const preview = typeof address === 'string' ? clip(address.trim(), 80) : typeof address;
    throw new TronCallError('invalid_address', `${label} is not a valid TRON address (${preview})`);
  }
}

/**
 * Collapse a decoded `balanceOf` result into a base-10 integer string.
 * TronWeb may return a bigint, a decimal string, a BigNumber, or a one-tuple.
 */
export function integerStringFromChainValue(value: unknown): string | undefined {
  if (typeof value === 'bigint') {
    return value >= 0n ? value.toString() : undefined;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return undefined;
    return String(value);
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    return /^(0|[1-9]\d*)$/.test(normalized) ? normalized : undefined;
  }
  if (Array.isArray(value)) {
    return value.length === 1 ? integerStringFromChainValue(value[0]) : undefined;
  }
  if (value && typeof value === 'object') {
    const record = value as {
      toFixed?: (digits: number) => string;
      isInteger?: () => boolean;
      isNegative?: () => boolean;
      _isBigNumber?: boolean;
      balance?: unknown;
    };
    const looksLikeBigNumber =
      typeof record.toFixed === 'function' && (record._isBigNumber === true || typeof record.isInteger === 'function');
    if (looksLikeBigNumber && record.toFixed) {
      if (record.isNegative?.()) return undefined;
      if (record.isInteger && !record.isInteger()) return undefined;
      const fixed = record.toFixed(0);
      return /^(0|[1-9]\d*)$/.test(fixed) ? fixed : undefined;
    }
    if ('balance' in record) {
      return integerStringFromChainValue(record.balance);
    }
  }
  return undefined;
}

export function classifyTronError(error: unknown, secret?: string): TronCallError {
  if (error instanceof TronCallError) {
    return secret ? reredeact(error, secret) : error;
  }

  const message = readMessage(error);
  const code = readCode(error);
  const status = readStatus(error);
  const detail = sanitizeCause(error, secret);
  const haystack = `${code ?? ''} ${message}`;

  let kind: TronErrorKind;
  let safeMessage: string;

  if (/invalid address|not a valid .*address|is not a valid TRON address/i.test(haystack)) {
    kind = 'invalid_address';
    safeMessage = 'TRON address was rejected';
  } else if (
    /private key|requires a signer|caller address is required|must be a private key|SIGERROR/i.test(haystack)
  ) {
    kind = 'configuration';
    safeMessage = 'TronWeb configuration or signer was rejected';
  } else if (isNodeOrNetwork(code, status, haystack)) {
    kind = 'node_or_network';
    safeMessage = 'TRON node or network request failed';
  } else if (isContractRejection(haystack) || (status !== undefined && status >= 400 && status < 500)) {
    kind = 'contract_revert';
    safeMessage = 'TRC-20 contract call was rejected';
  } else if (!message) {
    kind = 'node_or_network';
    safeMessage = 'TRON node or network request failed';
  } else {
    kind = 'contract_revert';
    safeMessage = 'TRC-20 contract call was rejected';
  }

  return new TronCallError(kind, safeMessage, { secret, detail });
}

export function findTronCallError(error: unknown): TronCallError | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    if (current instanceof TronCallError) return current;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function reredeact(error: TronCallError, secret: string): TronCallError {
  const messageHasSecret = error.message.includes(secret);
  const detailHasSecret = error.detail?.message.includes(secret) ?? false;
  if (!messageHasSecret && !detailHasSecret) return error;
  return new TronCallError(error.kind, error.message, {
    secret,
    detail: error.detail
      ? { ...error.detail, message: redact(error.detail.message, secret) }
      : undefined,
  });
}

function isNodeOrNetwork(code: string | undefined, status: number | undefined, haystack: string): boolean {
  if (code && NETWORK_CODES.has(code)) return true;
  if (status !== undefined && (status >= 500 || status === 408 || status === 429)) return true;
  return /timeout|timed out|network|fetch failed|socket hang up|getaddrinfo|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|503|502|504/i.test(
    haystack,
  );
}

function isContractRejection(haystack: string): boolean {
  return /revert|REVERT|OUT_OF_ENERGY|BANDWITH|BANDWIDTH|CONTRACT_VALIDATE|contract validate|insufficient|execution failed|Invalid constant call result|did not return a valid transaction|TRANSFER_FAILED|AccountResourceInsufficient/i.test(
    haystack,
  );
}

function sanitizeCause(error: unknown, secret?: string): SanitizedCause {
  const message = clip(redact(readMessage(error) || 'Unknown TRON client error', secret));
  const name = error instanceof Error ? error.name : undefined;
  const code = readCode(error);
  const status = readStatus(error);
  return {
    ...(name ? { name } : {}),
    message,
    ...(code ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

function readMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';

  const record = error as {
    message?: unknown;
    response?: { data?: unknown };
  };
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message;
  }
  const fromBody = readBodyMessage(record.response?.data);
  return fromBody ?? '';
}

function readBodyMessage(data: unknown): string | undefined {
  if (typeof data === 'string' && data.trim()) return data;
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ['message', 'Error', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  const result = record.result;
  if (result && typeof result === 'object') {
    const inner = result as { message?: unknown; code?: unknown };
    const parts = [inner.code, inner.message].filter((part): part is string => typeof part === 'string' && part.trim() !== '');
    if (parts.length > 0) return parts.join(': ');
  }
  return undefined;
}

function readCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  if (response && typeof response.status === 'number') return response.status;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function clip(value: string, max = MAX_DETAIL_LENGTH): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}
