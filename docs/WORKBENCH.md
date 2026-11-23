# LabelDesk Review Workbench

## Scope and visitor mode

One public review workbench and one public release comparison. Operate mode; the steward can compare without a wallet.

## Audience and task

Publishers freeze a revision; reviewers inspect and challenge one sampled label; the named buyer accepts a supported revision after its cutoff.

## Proof and content

Three synthetic support tickets, stable row IDs, a fixed refund rubric, an exact one-label change, per-revision findings, and the buyer receipt.

## Constraints

Show the full ticket text and governing clause together. State “3 of 3 sampled rows supported.” Keep pending, finalized, failed, and insufficient states distinct.

## Direction contract

THESIS: Read a release as a ticket wallet whose coupons preserve evidence and outcome; refuse dashboard cards and hidden evidence.
OWN-WORLD: Carrier navy, coupon white, carbon-purple codes, red correction and VOID marks, ruled fixed fields, airline grotesk headings, and tabular numerals.
STORY: Compare revision 1 with its label correction, inspect the exact ticket and rule, then follow the buyer receipt.
FIRST VIEWPORT: Header and one “Compare releases” link above two aligned release strips; selected ticket text and rubric occupy the largest field; sample result and receipt sit beside the row comparison.
FORM: Assigned direction 6/7, jet-age airline ticket wallet; seed key 9df6f779. Surface form 4/7, registered coupon comparison; seed key 172630aa. Code-led, delegated by the user.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Read-only StudioNet verification

Set the built-in network once, then use the active contract address from `deploy/proof.json`:

```powershell
npm exec --yes --package=genlayer@0.40.0 -- genlayer network set studionet
npm exec --yes --package=genlayer@0.40.0 -- genlayer call 0x92A07f60A8fA04F681d43c849903d62209A70b4B get_release_ids
npm exec --yes --package=genlayer@0.40.0 -- genlayer call 0x92A07f60A8fA04F681d43c849903d62209A70b4B get_release --args LABELDESK-REFUNDS-R1
npm exec --yes --package=genlayer@0.40.0 -- genlayer call 0x92A07f60A8fA04F681d43c849903d62209A70b4B get_release --args LABELDESK-REFUNDS-R2
npm exec --yes --package=genlayer@0.40.0 -- genlayer call 0x92A07f60A8fA04F681d43c849903d62209A70b4B get_comparison --args LABELDESK-REFUNDS-R1 LABELDESK-REFUNDS-R2
npm exec --yes --package=genlayer@0.40.0 -- genlayer call 0x92A07f60A8fA04F681d43c849903d62209A70b4B get_challenge --args CH-R1-104
npm exec --yes --package=genlayer@0.40.0 -- genlayer call 0x92A07f60A8fA04F681d43c849903d62209A70b4B get_challenge --args CH-R1-205
npm exec --yes --package=genlayer@0.40.0 -- genlayer call 0x92A07f60A8fA04F681d43c849903d62209A70b4B get_acceptance_receipt --args LABELDESK-REFUNDS-R2
```

The live record in `deploy/proof.json` stores the transaction links and the read-only outcomes. Do not re-submit a finalized action to reproduce it.
