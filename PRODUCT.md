# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Next.js App Router and TypeScript for the accessible workbench, with one GenLayer intelligent contract for immutable evidence and release decisions.

## Users

Publishers freeze labeled dataset revisions. Reviewers inspect sampled rows and can challenge a proposed label by naming the frozen row and governing rubric clause. Buyers and stewards inspect release comparisons without a wallet; only the named buyer can accept an eligible revision.

## Product Purpose

LabelDesk resolves disputed labels in a published dataset sample. Validators judge the exact frozen ticket text against the frozen rubric. Contract code calculates sample and release status, and the buyer records acceptance only after the challenge window has closed and every sampled row is supported.

## Positioning

The sample, rubric, threshold, and content digest are frozen with each revision. Judgments are revision-bound. A challenge reuses an already finalized finding for the same revision, row, label, and rubric; it requests a first judgment only when that exact evidence has not been adjudicated.

## Operating Context

The first workbench compares two synthetic customer-support releases with three predeclared sample rows and a 3-of-3 threshold. Revision 2 changes only the proposed label on “Where is the refund you approved on Tuesday?” The steward reaches one public comparison link without connecting a wallet. A separate ambiguity example remains outside the featured sample.

## Capabilities and Constraints

- Challenge outcomes are UPHELD when the proposed label is incorrect, REJECTED when it is supported, and UNRESOLVED when evidence is insufficient.
- Each sample row contributes exactly once to its revision denominator. Duplicate challenges do not add rows or votes.
- The challenge cutoff is fixed at publication. Buyer acceptance requires that it has passed, all sampled rows are adjudicated and supported, and no challenge is open.
- An unresolved row or expired review closes as failed and cannot be accepted. Eligibility and buyer acceptance are distinct states.
- A changed revision cannot inherit a passing result for changed evidence or omit a failing sampled row. Historical revision results remain inspectable.
- Describe the sample as “3 of 3 sampled rows supported”; never imply that the full dataset was certified.
- The product excludes a dataset marketplace, training pipeline, token, escrow, and payments. Synthetic examples must remain clearly labeled.

## Evidence on Hand

The active LabelDesk contract is deployed on StudioNet at [0x92A07f60A8fA04F681d43c849903d62209A70b4B](https://explorer-studio.genlayer.com/address/0x92A07f60A8fA04F681d43c849903d62209A70b4B). Its verified live comparison keeps revision 1 failed at 2 of 3 sampled rows and revision 2 accepted at 3 of 3, with a buyer receipt after the fixed cutoff. The one changed field is `TKT-104.proposedLabel`; the exact ticket, rubric, sample IDs, and threshold match across revisions. Two retired immutable deployments and all their transaction outcomes are preserved in `deploy/proof.json`.

All ticket text is synthetic. “3 of 3 sampled rows supported” describes only the fixed sample and does not certify the full dataset. The live demo uses the same configured wallet for publisher, reviewer, and buyer; direct tests exercise distinct addresses for authorization rules.

## Product Principles

- Freeze evidence before review.
- Preserve disagreements and distinguish agreed INSUFFICIENT findings from transactions that never reached consensus.
- Calculate counts and eligibility in contract logic, not from frontend assertions.
- Make evidence and release comparisons readable without a wallet.
- Never describe the three-row sample as certification of the full dataset.

## Accessibility & Inclusion

The public comparison and review workbench must remain useful without a wallet, keyboard accessible, readable on mobile, and explicit about pending, finalized, failed, and unresolved states.
