# LabelDesk

LabelDesk is a GenLayer application for freezing proposed labels, reviewing a sample against a frozen rubric, challenging a specific sampled row and clause, and comparing controlled releases. The public `/compare` view is readable without a wallet. The examples are synthetic and do not represent real support tickets.

## Public app

- [Review workbench](https://labeldesk-alpha.vercel.app/)
- [Walletless release comparison](https://labeldesk-alpha.vercel.app/compare)
- [Portal description, reviewer steps, and expected outcome](docs/portal.md)

Open **Compare releases** to inspect the corrected label, exact ticket, governing clause, and buyer receipt without a wallet. Follow the transaction links next to each acceptance attempt. The separate ambiguity example links to its own StudioNet judgment.

**Expected outcome.** Revision 1 stays failed at 2 of 3 sampled rows supported. Revision 2 corrects one label and the buyer accepts it after the cutoff with 3 of 3 sampled rows supported. The separate ambiguity example contributes zero rows to that count.

## Current deployment

- Network: GenLayer StudioNet, chain ID `61999`
- Active contract: [`0x92A07f60A8fA04F681d43c849903d62209A70b4B`](https://explorer-studio.genlayer.com/address/0x92A07f60A8fA04F681d43c849903d62209A70b4B)
- Two immutable deployments are retired: the first had an address-storage defect; the second used a 30-second revision 2 cutoff that expired before terms approval. Its expired review was closed without acceptance.
- Deployment, live transaction hashes, roles, and the Portal evidence draft are recorded in [`deploy/proof.json`](deploy/proof.json) and [`docs/PORTAL_DRAFT.md`](docs/PORTAL_DRAFT.md).
- The earlier partial run is preserved in [`deploy/attempts/0xcf93AcA332767391af8002fB09f82eE06f6deFEb-retired-short-cutoff.json`](deploy/attempts/0xcf93AcA332767391af8002fB09f82eE06f6deFEb-retired-short-cutoff.json).

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3134/compare` for the walletless comparison or `http://localhost:3134/` for the review workbench.

## Contract checks

```powershell
python -X utf8 -m pytest tests/direct -q
python -X utf8 -m genvm_linter.cli check contracts/labeldesk.py --json
python -X utf8 -m genvm_linter.cli schema contracts/labeldesk.py --output deploy/labeldesk.abi.json
npm run typecheck
npm run build
```

Direct tests cover all 24 permutations of the featured sample, challenge reuse and first-judgment paths, revision binding, the buyer acceptance cutoff, a pending-challenge boundary, expired review with and without terms approval, and string-to-`Address` conversion for ABI inputs. These checks use the direct GenLayer test harness; they do not substitute for a live validator judgment.

## StudioNet deployment

The contract pins its GenVM runner in the first line of `contracts/labeldesk.py`. The project used fee-aware GenLayer CLI `0.40.0` and `genlayer-js` `2.0.0` for StudioNet transactions. Set the CLI network once, then use its built-in chain definition for read-only checks:

```powershell
npm exec --yes --package=genlayer@0.40.0 -- genlayer network set studionet
npm exec --yes --package=genlayer@0.40.0 -- genlayer schema 0x92A07f60A8fA04F681d43c849903d62209A70b4B
```

The live scenario script is `deploy/run-live-scenario.js`. It records each action before submission, waits for finality, preserves finalized errors and disagreements, and refuses a blind resubmission. Both featured releases use a 600-second challenge window so buyer terms can finalize before the frozen cutoff. Do not rerun the script after the recorded live sequence has completed. If an action is pending, poll the recorded transaction hash and resume from its proof entry.

Every deployed contract has its own direct Explorer address evidence entry in `deploy/proof.json`, including both retired deployments and the active contract. StudioNet is a test network; the three-row sample is not certification of the full dataset.

## Sample and comparison

The two featured releases share their four frozen rows, sample membership (`TKT-104`, `TKT-205`, `TKT-318`), rubric, and 3-of-3 threshold. Revision 2 changes only `TKT-104.proposedLabel` from `NEW_REFUND_REQUEST` to `REFUND_STATUS` for “Where is the refund you approved on Tuesday?” The compare page shows the field-level difference, exact ticket text, clauses, sample results, failed revision 1 acceptance attempt, and revision 2 buyer receipt. It states that 3 of 3 sampled rows are supported without implying the full dataset was certified.

## Verified live result

- Revision 1 remains `FAILED`: 2 of 3 sampled rows supported; the buyer acceptance attempt finalized with a contract error and no receipt.
- Revision 2 is `ACCEPTED`: 3 of 3 sampled rows supported, no open challenge, and the buyer receipt was issued after the frozen cutoff (`AR-789994585569edd8d566d179`).
- The `TKT-104` challenge was `UPHELD` by reusing the finalized finding. The `TKT-205` challenge was `REJECTED` after triggering that row’s first judgment.
- The separate public frontend example, “Any news about my refund?”, finalized with majority agreement as INSUFFICIENT because the ticket did not establish prior approval or issuance. [StudioNet ambiguity judgment](https://explorer-studio.genlayer.com/tx/0xba212e4779166ed95033f2217df0b065b75e68e9fdc6796ce07de7c8622965ca)

## Public frontend test

Run with Google Chrome installed using the dedicated StudioNet test account:

    node tests/studionet-frontend.mjs

The script signs in Node and injects an EIP-1193 provider into a clean browser session. It journals submitted hashes in the proof manifest. Its gitignored .env.studionet-test stores a dedicated faucet account. Existing hashes are polled without resubmitting.

## Portal submission

`docs/portal.md` contains draft copy and separate evidence entries. No Portal form was submitted and the repository remains private.

## Fresh public frontend run

StudioNet series LABELDESK-PORTAL-MWTOMQH2 ran through the public browser interface with a scripted faucet account. Revision 1 remained failed at 2 of 3 supported. The corrected revision was accepted after the cutoff with 3 of 3 supported. Receipt AR-20c9fc27bd732fe5da78341d.

- [Fresh R2 buyer acceptance](https://explorer-studio.genlayer.com/tx/0xf86c6806862bb7d33d7767af3d8ffb1c5417c0700f102703c30057ce85256990)
- [All public frontend transaction hashes](deploy/proof.json)
