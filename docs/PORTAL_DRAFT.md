# LabelDesk Portal Submission Draft

**Status:** Draft only. Do not treat this document as a submitted Portal form.

## Project description

LabelDesk resolves disputed dataset labels through immutable, revision-bound GenLayer judgments. Publishers freeze proposed labels, the sample, rubric, and threshold. A reviewer can challenge a frozen row and rubric clause. A matching finalized judgment is reused; otherwise the challenge triggers the first judgment. Buyers accept only after the published cutoff, when every sampled row is supported and no challenge remains open.

The featured comparison uses synthetic refund-ticket examples. Revision 2 changes only the proposed label for “Where is the refund you approved on Tuesday?” It shows the exact field-level difference, both sample outcomes, and the buyer’s acceptance receipt. **3 of 3 sampled rows supported** describes only the fixed sample and does not certify the full dataset.

Verified live result: revision 1 remains failed with 2 of 3 sampled rows supported and no acceptance receipt. Revision 2 was accepted after its fixed cutoff with 3 of 3 sampled rows supported. The `TKT-104` challenge was UPHELD by reusing its finalized finding; the `TKT-205` challenge was REJECTED after its first judgment. All examples are synthetic.

## Network and active contract

- Network: GenLayer StudioNet (`61999`)
- Active contract: `0x92A07f60A8fA04F681d43c849903d62209A70b4B`
- Active deployment transaction: `0x790e4032a1e8911276be0a7fa0df261d7ab51c1450e879b2a9b65d82c02f7492`

## Evidence entries

Each deployed contract address is its own evidence entry, verified on StudioNet.

1. **Evidence type: GenLayer Explorer Contract** — Active LabelDesk contract: [StudioNet Explorer address](https://explorer-studio.genlayer.com/address/0x92A07f60A8fA04F681d43c849903d62209A70b4B)
2. **Evidence type: GenLayer Explorer Contract** — Retired deployment (30-second R2 cutoff; expired without acceptance): [StudioNet Explorer address](https://explorer-studio.genlayer.com/address/0xcf93AcA332767391af8002fB09f82eE06f6deFEb)
3. **Evidence type: GenLayer Explorer Contract** — Retired first deployment (address-storage defect): [StudioNet Explorer address](https://explorer-studio.genlayer.com/address/0xd2f7d55a206FBF1a0a136cDFBE56952eDBaD10fB)
4. **Evidence type: GenLayer Explorer Transaction** — Active contract deployment: [StudioNet transaction](https://explorer-studio.genlayer.com/tx/0x790e4032a1e8911276be0a7fa0df261d7ab51c1450e879b2a9b65d82c02f7492)
5. **Evidence type: GenLayer Explorer Transaction** — Prior corrected deployment: [StudioNet transaction](https://explorer-studio.genlayer.com/tx/0xd1158260a816f8b95fc2e4296ca83ca474f3df5253881a0a3fe5d24b485efb01)
6. **Evidence type: GenLayer Explorer Transaction** — Revision 1 buyer acceptance attempt (failed, no receipt): [StudioNet transaction](https://explorer-studio.genlayer.com/tx/0x7c2ae97116650e7ffe6820325bec4b1d743a781a99d9349ae82f634dd24a958f)
7. **Evidence type: GenLayer Explorer Transaction** — Revision 2 buyer acceptance receipt (`AR-789994585569edd8d566d179`): [StudioNet transaction](https://explorer-studio.genlayer.com/tx/0xe1ff38641c630cdcf54c4fad6e7e673949f42d5bde7b54524ac43076ea73ec9b)
8. **Evidence type: Source Code** — Contract source: `contracts/labeldesk.py` (repository visibility remains private).

Live release, judgment, challenge, acceptance, and failure transaction entries are listed separately in `deploy/proof.json`; add them as separate evidence entries if the Portal accepts transaction evidence. A transaction link does not replace either contract-address Explorer entry.

## Notes

- Dataset and ticket examples are synthetic.
- The active deployment is on StudioNet, not mainnet.
- The first immutable deployment is retired and separately disclosed above.
- A second immutable deployment is also retired: its R2 terms approval missed the 30-second cutoff, and the review was closed with `BUYER_TERMS_NOT_APPROVED_BY_CUTOFF`; it has no acceptance receipt. The final deployment uses 600-second cutoffs.
- Failed envelope submissions and finalized contract errors are preserved in `deploy/proof.json` and the archived attempt record; none are model disagreements or judgments.
- This is a draft package only. No Portal submission or repository visibility change has been made.
