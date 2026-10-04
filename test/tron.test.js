const assert = require('node:assert/strict');
const test = require('node:test');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
require('reflect-metadata');

const {
  DEFAULT_FEE_LIMIT_SUN,
  TRON_MODULE_OPTIONS,
  TronCallError,
  TronService,
  TronWebModule,
  classifyTronError,
  createTronWebClient,
  toRuntimeOptions,
} = require('../dist');
const { parseTokenAmount } = require('../dist/tron/tron.errors');

const OWNER = 'TOwnerAddress111111111111111111111';
const CONTRACT = 'TContractAddress11111111111111111';
const RECIPIENT = 'TRecipientAddress1111111111111111';
const KNOWN_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

test('parseTokenAmount accepts integer strings and bigints', () => {
  assert.equal(parseTokenAmount('0'), '0');
  assert.equal(parseTokenAmount('1000'), '1000');
  assert.equal(parseTokenAmount(42n), '42');
});

test('parseTokenAmount rejects decimals, signs, and padded zeros', () => {
  for (const value of ['', '1.5', '-1', '01', '1e2', ' 1', '1 ']) {
    assert.throws(() => parseTokenAmount(value), (error) => error instanceof TronCallError && error.kind === 'invalid_amount');
  }
  assert.throws(() => parseTokenAmount(-1n), (error) => error.kind === 'invalid_amount');
});

test('classifyTronError maps transport failures and reverts', () => {
  const timeout = new Error('connect ETIMEDOUT');
  timeout.code = 'ETIMEDOUT';
  assert.equal(classifyTronError(timeout).kind, 'node_or_network');

  const refused = new Error('connect ECONNREFUSED 127.0.0.1:443');
  refused.code = 'ECONNREFUSED';
  assert.equal(classifyTronError(refused).kind, 'node_or_network');

  const http = new Error('Request failed');
  http.response = { status: 503, data: { Error: 'unavailable' } };
  assert.equal(classifyTronError(http).kind, 'node_or_network');
  assert.equal(classifyTronError(http).detail.status, 503);

  const revert = new Error('REVERT opcode executed');
  assert.equal(classifyTronError(revert).kind, 'contract_revert');

  const validate = new Error('contract validate error');
  assert.equal(classifyTronError(validate).kind, 'contract_revert');

  const already = new TronCallError('invalid_amount', 'Amount must be a non-negative integer in smallest token units');
  assert.equal(classifyTronError(already), already);
});

test('classifyTronError redacts a configured secret from the detail', () => {
  const secret = 'super-secret-value';
  const error = new Error(`REVERT opcode executed ${secret}`);
  const classified = classifyTronError(error, secret);
  assert.equal(classified.kind, 'contract_revert');
  assert.equal(classified.message.includes(secret), false);
  assert.equal(classified.detail.message.includes(secret), false);
  assert.match(classified.detail.message, /\[redacted\]/);
});

test('module options reject bad hosts and never echo a rejected key', () => {
  assert.throws(
    () => createTronWebClient({ fullHost: 'ftp://api.shasta.trongrid.io' }),
    (error) => error instanceof TronCallError && error.kind === 'configuration',
  );

  assert.throws(
    () => createTronWebClient({ fullHost: 'https://user:super-secret-pass@api.shasta.trongrid.io' }),
    (error) => {
      assert.equal(error.kind, 'configuration');
      assert.equal(error.message.includes('super-secret-pass'), false);
      return true;
    },
  );

  assert.throws(
    () =>
      createTronWebClient({
        fullHost: 'https://api.shasta.trongrid.io',
        privateKey: 'super-secret-value',
      }),
    (error) => {
      assert.equal(error.kind, 'configuration');
      assert.equal(error.message.includes('super-secret-value'), false);
      assert.equal(JSON.stringify(error.detail ?? {}).includes('super-secret-value'), false);
      return true;
    },
  );
});

test('runtime options keep the host and fee limit and omit header secrets', () => {
  const runtime = toRuntimeOptions({
    fullHost: ' https://api.shasta.trongrid.io ',
    headers: { 'TRON-PRO-API-KEY': 'super-secret-api-key' },
    defaultTrc20Contract: KNOWN_CONTRACT,
  });
  assert.equal(runtime.fullHost, 'https://api.shasta.trongrid.io');
  assert.equal(runtime.feeLimit, DEFAULT_FEE_LIMIT_SUN);
  assert.equal(runtime.hasPrivateKey, false);
  assert.equal(runtime.defaultTrc20Contract, KNOWN_CONTRACT);
  assert.equal(JSON.stringify(runtime).includes('super-secret-api-key'), false);
});

test('createTronWebClient validates a public contract address locally', () => {
  const client = createTronWebClient({
    fullHost: 'https://api.shasta.trongrid.io',
    defaultTrc20Contract: KNOWN_CONTRACT,
  });
  assert.equal(client.isAddress(KNOWN_CONTRACT), true);
  assert.throws(
    () =>
      createTronWebClient({
        fullHost: 'https://api.shasta.trongrid.io',
        defaultTrc20Contract: 'not-an-address',
      }),
    (error) => error.kind === 'configuration',
  );
});

test('TronService reads a balance and classifies call failures', async () => {
  const { client, calls } = fakeClient();
  const service = new TronService(client, {
    fullHost: 'https://api.shasta.trongrid.io',
    feeLimit: DEFAULT_FEE_LIMIT_SUN,
    hasPrivateKey: false,
    defaultTrc20Contract: CONTRACT,
  });

  const balance = await service.getTrc20Balance(OWNER);
  assert.deepEqual(balance, { contractAddress: CONTRACT, owner: OWNER, amount: '42' });
  assert.equal(calls.at(-1).method, 'balanceOf');
  assert.deepEqual(calls.at(-1).args, [OWNER]);
  assert.deepEqual(calls.at(-1).options, { from: OWNER });

  await assert.rejects(() => service.getTrc20Balance('not-an-address', CONTRACT), (error) => error.kind === 'invalid_address');

  const unconfigured = new TronService(client, {
    fullHost: 'https://api.shasta.trongrid.io',
    feeLimit: DEFAULT_FEE_LIMIT_SUN,
    hasPrivateKey: false,
  });
  await assert.rejects(() => unconfigured.getTrc20Balance(OWNER), (error) => error.kind === 'configuration');

  const offline = fakeClient({
    contract() {
      return {
        read: {
          balanceOf: async () => {
            const error = new Error('getaddrinfo ENOTFOUND api.shasta.trongrid.io');
            error.code = 'ENOTFOUND';
            throw error;
          },
        },
        write: { transfer: async () => '' },
      };
    },
  });
  const offlineService = new TronService(offline.client, {
    fullHost: 'https://api.shasta.trongrid.io',
    feeLimit: DEFAULT_FEE_LIMIT_SUN,
    hasPrivateKey: false,
    defaultTrc20Contract: CONTRACT,
  });
  await assert.rejects(() => offlineService.getTrc20Balance(OWNER), (error) => error.kind === 'node_or_network');
});

test('TronService transfer checks the amount, the signer, and revert redaction', async () => {
  const secret = 'fixture-secret-value';
  const { client, calls } = fakeClient({ defaultPrivateKey: secret });
  const service = new TronService(client, {
    fullHost: 'https://api.shasta.trongrid.io',
    feeLimit: DEFAULT_FEE_LIMIT_SUN,
    hasPrivateKey: true,
    defaultTrc20Contract: CONTRACT,
  });

  await assert.rejects(
    () => service.transferTrc20({ to: RECIPIENT, amount: '1.2', contractAddress: CONTRACT }),
    (error) => error.kind === 'invalid_amount',
  );
  assert.equal(calls.some((call) => call.method === 'transfer'), false);

  const sent = await service.transferTrc20({ to: RECIPIENT, amount: '1000' });
  assert.equal(sent.amount, '1000');
  assert.equal(sent.from, OWNER);
  assert.equal(sent.to, RECIPIENT);
  assert.equal(sent.txId, 'ab'.repeat(32));
  const transferCall = calls.find((call) => call.method === 'transfer');
  assert.deepEqual(transferCall.args, [RECIPIENT, 1000n]);
  assert.deepEqual(transferCall.options, { feeLimit: DEFAULT_FEE_LIMIT_SUN });
  assert.equal('account' in transferCall.options, false);

  const readOnly = new TronService(fakeClient().client, {
    fullHost: 'https://api.shasta.trongrid.io',
    feeLimit: DEFAULT_FEE_LIMIT_SUN,
    hasPrivateKey: false,
    defaultTrc20Contract: CONTRACT,
  });
  await assert.rejects(
    () => readOnly.transferTrc20({ to: RECIPIENT, amount: '1', contractAddress: CONTRACT }),
    (error) => error.kind === 'configuration',
  );

  const reverting = fakeClient({
    defaultPrivateKey: secret,
    contract() {
      return {
        read: { balanceOf: async () => 0n },
        write: {
          transfer: async () => {
            throw new Error(`REVERT opcode executed ${secret}`);
          },
        },
      };
    },
  });
  const revertingService = new TronService(reverting.client, {
    fullHost: 'https://api.shasta.trongrid.io',
    feeLimit: DEFAULT_FEE_LIMIT_SUN,
    hasPrivateKey: true,
    defaultTrc20Contract: CONTRACT,
  });
  await assert.rejects(
    () => revertingService.transferTrc20({ to: RECIPIENT, amount: 5n, contractAddress: CONTRACT }),
    (error) => {
      assert.equal(error.kind, 'contract_revert');
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.detail.message.includes(secret), false);
      return true;
    },
  );
});

test('Nest boots forRoot and forRootAsync without a signing key', { timeout: 30_000 }, async () => {
  class RootModule {}
  Module({
    imports: [
      TronWebModule.forRoot({
        fullHost: 'https://api.shasta.trongrid.io',
        defaultTrc20Contract: KNOWN_CONTRACT,
      }),
    ],
  })(RootModule);

  const app = await NestFactory.createApplicationContext(RootModule, { logger: false });
  try {
    const service = app.get(TronService);
    assert.equal(typeof service.getTrc20Balance, 'function');
    const runtime = app.get(TRON_MODULE_OPTIONS);
    assert.equal(runtime.fullHost, 'https://api.shasta.trongrid.io');
    assert.equal(runtime.hasPrivateKey, false);
    assert.equal(runtime.defaultTrc20Contract, KNOWN_CONTRACT);
    assert.equal(Object.hasOwn(runtime, 'privateKey'), false);
    assert.equal(Object.hasOwn(runtime, 'headers'), false);
  } finally {
    await app.close();
  }

  class AsyncModule {}
  Module({
    imports: [
      TronWebModule.forRootAsync({
        useFactory: () => ({ fullHost: 'https://nile.trongrid.io' }),
      }),
    ],
  })(AsyncModule);

  const asyncApp = await NestFactory.createApplicationContext(AsyncModule, { logger: false });
  try {
    const runtime = asyncApp.get(TRON_MODULE_OPTIONS);
    assert.equal(runtime.fullHost, 'https://nile.trongrid.io');
    assert.equal(typeof asyncApp.get(TronService).getClient().isAddress, 'function');
  } finally {
    await asyncApp.close();
  }
});

function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    isAddress(address) {
      return address === OWNER || address === CONTRACT || address === RECIPIENT;
    },
    defaultAddress: { base58: OWNER, hex: '41abc' },
    defaultPrivateKey: false,
    contract(_abi, address) {
      calls.push({ address });
      return {
        read: {
          async balanceOf(args, options) {
            calls.push({ method: 'balanceOf', args, options });
            return 42n;
          },
        },
        write: {
          async transfer(args, options) {
            calls.push({ method: 'transfer', args, options });
            return 'ab'.repeat(32);
          },
        },
      };
    },
    ...overrides,
  };
  return { client, calls };
}
