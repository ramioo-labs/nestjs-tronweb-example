# nestjs-tronweb-example

Small, production-oriented NestJS module wrapping [TronWeb](https://github.com/tronprotocol/tronweb):

- Injectable `TronWeb` via `TronWebModule.forRoot` / `forRootAsync`
- `TronService` helpers for TRC-20 `balanceOf` and `transfer`
- Typed `TronCallError` for invalid address, invalid amount, contract rejection, node/network failure, and configuration mistakes

This lives **outside** TronWeb core docs. On [tronweb#713](https://github.com/tronprotocol/tronweb/issues/713) the maintainer pointed at the existing contract guide ([read / write namespaces](https://tronweb.network/docu/docs/Interact%20with%20contract#read--write-typed-namespaces)) rather than adding another copy to the core tree. The NestJS example is complementary to the Shasta script guide in [tronweb#714](https://github.com/tronprotocol/tronweb/pull/714): that PR is a standalone test script, and this repo is the backend/provider side.

[@goldman0020](https://github.com/goldman0020) agreed on #713 to review and support this NestJS example while staying focused on #714.

## Install

NestJS packages are peer dependencies. `tronweb` is a direct dependency.

```bash
npm install tronweb @nestjs/common @nestjs/core reflect-metadata rxjs
```

From a checkout of this repo:

```bash
npm install
npm test
npm run build
cp .env.example .env
npm run start:example
```

`ts-node` works too, after `npm install`:

```bash
npx ts-node src/example/main.ts
```

The demo does not broadcast a transfer unless `TRON_DEMO_TRANSFER=true`. With a blank `.env` it boots, prints a short note, and exits.

## Usage

```ts
import { Module } from '@nestjs/common';
import { TronWebModule, TronService } from 'nestjs-tronweb-example';

@Module({
  imports: [
    TronWebModule.forRootAsync({
      useFactory: () => ({
        fullHost: process.env.TRON_FULL_HOST || 'https://api.shasta.trongrid.io',
        headers: process.env.TRON_API_KEY
          ? { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY }
          : undefined,
        privateKey: process.env.TRON_PRIVATE_KEY, // optional; required for transfer
        defaultTrc20Contract: process.env.TRC20_CONTRACT,
      }),
    }),
  ],
})
export class AppModule {}
```

Inject `TronService`:

```ts
constructor(private readonly tron: TronService) {}

async check(owner: string, contract: string) {
  return this.tron.getTrc20Balance(owner, contract);
}

async send(to: string, amountSmallestUnits: string, contract: string) {
  return this.tron.transferTrc20({
    contractAddress: contract,
    to,
    amount: amountSmallestUnits,
  });
}
```

`amount` is the integer uint256 in smallest token units (a base-10 string or `bigint`), not a decimal token amount. `transferTrc20` signs with the module `privateKey`. TronWeb's write `account` option is itself a private key, so this wrapper does not take a per-call key.

`TronWebModule` is global. The injected `TRON_MODULE_OPTIONS` object is a non-secret view (`fullHost`, fee limit, whether a key was set). The key and headers stay on the TronWeb client.

For anything else, `tron.getClient()` returns that client. Do not log it.

Enable `experimentalDecorators` and `emitDecoratorMetadata`, and import `reflect-metadata` once at process startup. See `src/example`.

## Error handling

`TronCallError.kind` is one of `invalid_address`, `invalid_amount`, `contract_revert`, `node_or_network`, or `configuration`. `message` is safe to return to callers. `detail` is a short sanitized summary (name, message, code, status) for logs.

The table and the classification rules are in [ERROR_HANDLING.md](./ERROR_HANDLING.md).

## Security

- Never commit `.env` or put a private key in source, logs, or error messages.
- Prefer a TronGrid key in `headers` over credentials embedded in `fullHost` (those URLs are rejected).
- Keep signing keys in a secrets manager. This example holds the key in memory only so TronWeb can sign.
- `privateKey` and `defaultAddress` are mutually exclusive. The key's address is the signer.
- Read calls pass the balance owner as the constant-call `from` address, so balance checks work without a signing key.

## License

MIT
