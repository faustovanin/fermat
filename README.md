# FERMAT

Code and data for the article **"FERMAT: Functional Equivalence for Regulatory Medicine Authentication and Traceability"**.

FERMAT connects the EU medicine verification regime (FMD/EMVS) and the US tracing regime (DSCSA) through a shared GS1 EPCIS/CBV layer and a permissioned Hyperledger Fabric channel. A smart contract (chaincode) scores each EPCIS event for logistics diversion and rejects events that break an item's expected history.

This repository contains the files needed to **understand** the implementation and to inspect the data behind the article's results. It is not packaged to run end to end: network provisioning, container setup, and run orchestration are left out.

## Contents

| Folder | What it holds | Article section |
|---|---|---|
| `chaincode/` | JavaScript chaincode: contract, rule engine, and rules | Smart Contract and Counterfeit Score |
| `converter/` | Python code that turns ARCOS records into EPCIS 2.0 item histories with ground truth | Input Workload |
| `experiments/caliper/` | Hyperledger Caliper workload that submits events and records each outcome and timing | Prototype; Evaluation Metrics |
| `experiments/analysis/` | Dataset preparation, local replay of the contract, capture evaluation, and chart generation | Prototype; Evaluation Metrics |
| `experiments/results/` | Measured results of the reported runs | Experiments and Results |
| `dataset/` | Generated EPCIS datasets and ground truth of the reported runs | Input Workload; Evaluation Scenarios |

## chaincode/

- `index.js`: entry point that exposes the contract to Fabric.
- `lib/traceabilityContract.js`: `TraceabilityContract`, with `createEpcisEvent` for submission and query functions for events and product states.
- `lib/RuleEngine.js`: runs the structural rules (stopping at the first failure) and then all circulation rules, and computes the counterfeit score as the highest score among the failed rules.
- `lib/EpcisMapping.js`, `lib/constants/EpcisConstants.js`: EPCIS field mapping and CBV constants.
- `lib/rules/`:
  - `TaxonomyRule.js`: base class and result type shared by all rules.
  - Structural rules: `MandatoryFieldsRule.js`, `EventTimeRule.js`, `DuplicateEventRule.js`.
  - Circulation rules evaluated in the article: `LogisticsDiversionRule.js` (sequence, timestamp, and jurisdiction checks; scores 75, 60, 80) and `SupplyBaseComplexityRule.js` (supplier count; scores 0/30/60/85).
  - Two placeholder rules for future use cases (physical tampering and post-market fraud) ran in the reported experiments but always passed. We removed them from this repository; they did not affect any score or outcome.
- `package.json`: dependencies (`fabric-contract-api` and `fabric-shim` 2.5.8).

Some code comments are in Portuguese.

## converter/

- `extract.py`: reads the ARCOS file and writes a normalized CSV.
- `eu_us.py`: `generate(source, output, event_count, seed, anomaly_rate, diagnostic)` builds one serialized item per source row with the ten-event EU–US history (six physical events and four supporting observations), injects anomalies into 1% of the histories, and writes the events, ground truth, and lineage files.
- `load.py`: EPCIS event builders (`ObjectEvent`, `AggregationEvent`, `TransactionEvent`) and the deterministic HMAC-based item identifiers.
- `examples/`: one example of each EPCIS event type.

ARCOS is the US Drug Enforcement Administration's reporting system for controlled-substance distribution: <https://www.deadiversion.usdoj.gov/arcos/arcos.html>. The raw ARCOS file is not redistributed here.

## experiments/

- `caliper/workloads/submitEpcisEvents.js`: Caliper workload module, one worker with at most one request in flight; `epcisDataset.js` loads the dataset and maps identifiers to a run namespace; `transactionOutcome.js` classifies each response (accepted, rule-rejected, or failure).
- `caliper/measurement/`: monotonic request timing, bounded admission, and worker resource sampling.
- `analysis/prepare_eu_us_suite.py`: prepares the size scenarios. It expects the original multi-repository layout, so paths need adjusting.
- `analysis/replay_current_chaincode.js`: in-memory replay of the contract that supplies the expected outcomes.
- `analysis/evaluate_caliper_capture.py`, `analysis/evaluate_eu_us_capture.py`: detection and performance metrics from a capture.
- `analysis/generate_article_charts.py`, `analysis/chart-settings.json`: the article's result charts.
- `results/S100`, `results/S1000`, `results/S5000`: `evaluation.json` (summary metrics), `latency.csv` (per-request durations), `histories.csv` and `targets.csv` (detection per history and per target), `products.csv` (final product states), `rates-10s.csv` (throughput in 10-second windows).
- `results/diagnostic`: the same files for the diagnostic run, which the article excludes from its results.
- `results/article-charts`: the data behind the article's charts, including `run-summary.csv` with the values of the results table.

## dataset/

One folder per run: `S100`, `S1000`, and `S5000` (100, 1,000, and 5,000 events; 10, 100, and 500 item histories) and `diagnostic` (rule diagnostics with negative controls). All use seed 42.

- `events.json`: the EPCIS 2.0 document submitted to the channel.
- `ground_truth.json`: injection labels per history, the designated target events, the expected rule codes, and a SHA-256 hash of the events.
- `event-metadata.jsonl`: one line per event with its item, route leg, source-row lineage, and anomaly label.
- `scenario.csv`: the scenario parameters.

The European parties, locations, containers, and business times are synthetic. Item identifiers are synthetic GS1-style identifiers, not commercial GTIN assignments. The labels describe synthetic modifications, not real counterfeit medicines.

## Testbed

Hyperledger Fabric 2.5.16 (two organizations, one peer each, one orderer, CouchDB 3.4.2 per peer), Hyperledger Caliper 0.6.0, Node.js 22.22.3, on a single ARM64 host. See the article for the full configuration.

## Citation

[TO COMPLETE: article reference and DOI]

## License

The code is released under the MIT License; see [LICENSE](LICENSE).

The data in `dataset/` and `experiments/results/` are released under the [Creative Commons Attribution 4.0 International License (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
