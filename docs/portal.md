# LabelDesk

## Product description

LabelDesk helps data stewards resolve disputed labels before a buyer accepts a release. The publisher freezes synthetic support tickets, the exact sample, rubric, and threshold. A reviewer challenges a named row and rubric clause. GenLayer reuses a matching finalized finding or judges the evidence for the first time. The buyer can accept when the cutoff has passed, all three sampled labels are supported, and every challenge is closed. A corrected release preserves the original outcome and exposes the single field that changed.

## Reviewer steps

1. Open [Compare releases](https://labeldesk-alpha.vercel.app/compare) without connecting a wallet.
2. Read TKT-104 and the REFUND_STATUS clause. Check that only the proposed label changed.
3. Compare the two sample counts and open the buyer’s failed attempt and successful receipt.
4. Inspect the separate ambiguity example and its StudioNet judgment. The ticket examples are synthetic.

## Expected outcome

Revision 1 stays failed at 2 of 3 sampled rows supported. Revision 2 changes one label and is accepted after its frozen cutoff with 3 of 3 sampled rows supported. The buyer receipt is visible next to both outcomes. The separate ambiguity example finalized as INSUFFICIENT because the ticket does not establish prior approval or issuance.

## Evidence

- **GenLayer Explorer Contract** · [Active LabelDesk contract](https://explorer-studio.genlayer.com/address/0x92A07f60A8fA04F681d43c849903d62209A70b4B)
- **GenLayer Explorer Contract** · [Retired address storage deployment](https://explorer-studio.genlayer.com/address/0xd2f7d55a206FBF1a0a136cDFBE56952eDBaD10fB)
- **GenLayer Explorer Contract** · [Retired short cutoff deployment](https://explorer-studio.genlayer.com/address/0xcf93AcA332767391af8002fB09f82eE06f6deFEb)
- **GenLayer Explorer Transaction** · [Featured R1 acceptance attempt](https://explorer-studio.genlayer.com/tx/0x7c2ae97116650e7ffe6820325bec4b1d743a781a99d9349ae82f634dd24a958f)
- **GenLayer Explorer Transaction** · [Featured R2 acceptance](https://explorer-studio.genlayer.com/tx/0xe1ff38641c630cdcf54c4fad6e7e673949f42d5bde7b54524ac43076ea73ec9b)
- **GenLayer Explorer Transaction** · [Public frontend ambiguity judgment](https://explorer-studio.genlayer.com/tx/0xba212e4779166ed95033f2217df0b065b75e68e9fdc6796ce07de7c8622965ca)
- **Source code** · [LabelDesk repository](https://github.com/JWattjr/labeldesk) (private)
- **Manifest** · [StudioNet deployment and transaction evidence](../deploy/proof.json)

Network is GenLayer StudioNet, chain ID 61999.

## Fresh public frontend run

StudioNet series LABELDESK-PORTAL-MWTOMQH2 ran through the public browser interface with a scripted faucet account. Revision 1 remained failed at 2 of 3 supported. The corrected revision was accepted after the cutoff with 3 of 3 supported. Receipt AR-20c9fc27bd732fe5da78341d.

The ambiguity judgment finalized with three votes in agreement and two in disagreement. The proof manifest retains the individual votes.

- **GenLayer Explorer Transaction** · [Publish R1](https://explorer-studio.genlayer.com/tx/0x69c40d42aa2e537a79efc7ab02e75a6f7268557e736e63dbd4833dca34d194fa)
- **GenLayer Explorer Transaction** · [Approve R1 terms](https://explorer-studio.genlayer.com/tx/0xabaf2a8c29229a2cdf8659272a3886addd0702000f440c0d64de3d080fb5e1fe)
- **GenLayer Explorer Transaction** · [Review R1 TKT-104](https://explorer-studio.genlayer.com/tx/0x7f0df36c2ea9c8b444ca586230b817b8519608167e7bc218539965f24ac20711)
- **GenLayer Explorer Transaction** · [Review R1 TKT-205](https://explorer-studio.genlayer.com/tx/0xb16cc393754e96acb632458cb85c7fee230edd33bfa74ca72e7f27263fde5929)
- **GenLayer Explorer Transaction** · [Review R1 TKT-318](https://explorer-studio.genlayer.com/tx/0x940369edbb0d3a56e2fc5d81709cddcf4c62546c91681b59d73550d070703018)
- **GenLayer Explorer Transaction** · [Challenge supported R1 label](https://explorer-studio.genlayer.com/tx/0x528b575efc009c0ce1f5b609be61731fcbb6d36eecbf82bb5bda0074efb81c63)
- **GenLayer Explorer Transaction** · [Publish R2](https://explorer-studio.genlayer.com/tx/0x6ddc90905014b878aba63ed0da2c43f6af02bfe4e349605b0474c83a45b7bd39)
- **GenLayer Explorer Transaction** · [Approve R2 terms](https://explorer-studio.genlayer.com/tx/0xfa16be99ca81244cd899c032d2fe2e66d32e5afb8948b839134566c6a36cd991)
- **GenLayer Explorer Transaction** · [Review R2 TKT-104](https://explorer-studio.genlayer.com/tx/0x29110142d993ef81bb68657b7f5a93b5f255be291142950a236e9157865d369e)
- **GenLayer Explorer Transaction** · [Review R2 TKT-205](https://explorer-studio.genlayer.com/tx/0x4359be7792718676ac993c27a6d8923f5871addfcd7fe9edc92be15a0dd063b8)
- **GenLayer Explorer Transaction** · [Review R2 TKT-318](https://explorer-studio.genlayer.com/tx/0xdbb4a55c2682378cdc99725c5ab35e69adbd37519fea382e236c1e1cd3b2b5b1)
- **GenLayer Explorer Transaction** · [Buyer accepts R2](https://explorer-studio.genlayer.com/tx/0xf86c6806862bb7d33d7767af3d8ffb1c5417c0700f102703c30057ce85256990)
