# Error handling

`TronService` throws `TronCallError` for every failed TRC-20 helper call. The `kind` is stable; the `message` does not include signing keys or header values. `detail` is a short summary of the underlying client error after the same redaction.

| Kind | When it surfaces | Suggested handling |
|------|------------------|--------------------|
| `invalid_address` | `owner`, `to`, or `contractAddress` is not a TRON address | Validate inputs; return 400 |
| `invalid_amount` | Amount is missing, fractional, negative, or not a base-10 integer string / bigint | Amounts are smallest units; return 400 |
| `contract_revert` | The node answered, but the call or transaction was rejected (Solidity revert, energy, bandwidth, validate error, unexpected return) | Surface a user-safe message; log `detail` |
| `node_or_network` | Timeout, DNS, connection reset, HTTP 408 / 429 / 5xx | Retry with backoff; fail over to another full node |
| `configuration` | Missing `fullHost`, bad URL, missing contract, missing signing key, bad fee limit, signer rejected at the client | Fail fast at boot for module options; return 500 for a request that cannot be signed |

Module options are checked when the provider is created, so a bad `fullHost` or private key fails Nest startup with `configuration` instead of on the first request.

`contract_revert` is broader than a Solidity `revert`. It means the node was reached and refused the call. Connectivity failures stay in `node_or_network`.

Do not log `TronWeb` instances or raw Axios errors from this client. If you catch `TronCallError`, log `kind`, `message`, and `detail` only. `detail.message` is clipped and stripped of the configured private key when that key is present on the client.
