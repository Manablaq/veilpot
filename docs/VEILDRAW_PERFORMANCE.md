# VeilDraw performance

All numeric rows below are **MEASURED RESULT** from the Hardhat in-process mock FHEVM using the
plugin's transaction-receipt HCU analyzer. They are not Sepolia measurements. Raw evidence is
[`hcu.json`](../evidence/gate0/hcu.json). Current official documentation gives limits of 20,000,000
global HCU and 5,000,000 sequential HCU per transaction.

## Bucket computation

The fixed seven-comparison encrypted binary search used 4,056,064 global HCU and 1,923,032
sequential HCU. The run-specific EVM gas value is intentionally read from `hcu.json`, which is the
authoritative generated record. It emits three public-decryption handles in one ordered proof
request: bucket exponent, zero flag, and supported-domain flag.

## Candidate and reduction measurements

Candidate generation includes bounded random generation, `X_i < T`, storage, and ACL operations.
Reductions were deliberately measured in separate transactions over the same persisted batch.

|   m | Candidate global | Candidate seq. | Serial global | Serial seq. | Balanced global | Balanced seq. |
| --: | ---------------: | -------------: | ------------: | ----------: | --------------: | ------------: |
|   1 |          240,000 |        240,000 |       106,066 |      82,034 |          57,032 |        57,032 |
|   2 |          480,000 |        240,000 |       212,068 |     139,034 |         138,032 |       114,000 |
|   4 |          960,000 |        240,000 |       424,072 |     253,034 |         300,032 |       171,000 |
|   8 |        1,920,000 |        240,000 |       848,080 |     481,034 |         624,032 |       228,000 |
|  16 |        3,840,000 |        240,000 |     1,696,096 |     937,034 |       1,272,032 |       285,000 |

Balanced was lower in global HCU, sequential HCU, and gas for every measured size, including `m=1`
because the implementation normalizes an invalid result with one select while serial maintains
first-seen state. No superiority was assumed before measurement.

## Failure and retries

For positive minimal buckets, `q < 1/2`; therefore the following are strict supremum bounds, not
attained maxima.

|   m |     `P(batch failure)` |        Expected attempts |
| --: | ---------------------: | -----------------------: |
|   1 |                `< 0.5` |                    `< 2` |
|   2 |               `< 0.25` | `< 1.333333333333333333` |
|   4 |             `< 0.0625` | `< 1.066666666666666667` |
|   8 |         `< 0.00390625` | `< 1.003921568627450981` |
|  16 | `< 0.0000152587890625` | `< 1.000015259021896697` |

Exact rational values for representative totals are generated in
[`statistical-sanity.json`](../evidence/gate0/statistical-sanity.json).

## Prefix settlement microbenchmark

| Participants | Global HCU | Sequential HCU | Limit observation                                           |
| -----------: | ---------: | -------------: | ----------------------------------------------------------- |
|            1 |    976,096 |        758,064 | comfortable                                                 |
|            2 |  1,952,128 |      1,017,064 | comfortable                                                 |
|            4 |  3,904,192 |      1,535,064 | comfortable                                                 |
|            8 |  7,808,320 |      2,571,064 | 51.4% of sequential limit                                   |
|           16 | 15,616,576 |      4,643,064 | 92.9% of sequential limit; insufficient production headroom |

The 16-participant probe fits locally but leaves only 356,936 sequential HCU and excludes later
settlement business logic. A production design should cap settlement chunks at eight participants
unless live measurements support a different cap. Chunking must carry an encrypted prefix and the
same immutable encrypted target; it does not alter selection probabilities.

## Selected batch size

**DESIGN DECISION:** `m=8` is the best Gate 0 batch size. Its strict worst-case retry probability is
below 0.390625%, while candidate generation and balanced reduction use 1.92M and 0.624M global HCU
respectively in separate measured transactions. `m=4` leaves a material sub-6.25% retry risk and
extra proof round trips; `m=16` doubles candidate cost for little liveness benefit and adds audit
surface. The choice considers failure, expected retries, HCU/depth headroom, transaction count,
public-decryption round trips, and implementation complexity.

## Not measured locally

Real coprocessor execution time, Sepolia gas behavior, KMS/relayer latency, proof propagation,
network contention, and end-to-end wall time are **NOT MEASURED LOCALLY**. No estimate is presented
as a measurement.
