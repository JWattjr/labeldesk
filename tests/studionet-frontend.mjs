import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { createClient, decodeLocalnetTransaction } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const origin = process.env.LABELDESK_PUBLIC_URL ?? "https://labeldesk-alpha.vercel.app";
assert.equal(new URL(origin).origin, origin);
assert.ok(origin.startsWith("https://"));
const proofPath = new URL("../deploy/proof.json", import.meta.url);
const keyPath = new URL("../.env.studionet-test", import.meta.url);
const proof = JSON.parse(readFileSync(proofPath, "utf8"));
const contract = proof.contract.address;
const chain = createClient({ chain: studionet });
assert.equal(await chain.request({ method: "eth_chainId" }), "0xf22f");
if (!existsSync(keyPath)) {
  writeFileSync(keyPath, "LABELDESK_TEST_KEY=" + generatePrivateKey() + "\n", { flag: "wx", mode: 0o600 });
}
const key = readFileSync(keyPath, "utf8").trim().split("=", 2)[1];
const account = privateKeyToAccount(key);
const explorer = "https://explorer-studio.genlayer.com";
const save = () => {
  const temp = new URL("../deploy/proof.json.tmp", import.meta.url);
  writeFileSync(temp, JSON.stringify(proof, null, 2) + "\n");
  renameSync(temp, proofPath);
};

const read = (functionName, ...args) => chain.readContract({
  address: contract, functionName, args, transactionHashVariant: "latest-final",
});
console.log("StudioNet test account", account.address);
const balance = BigInt(await chain.request({ method: "eth_getBalance", params: [account.address, "latest"] }));
if (balance < 2000000000000000000n) {
  const result = await chain.request({ method: "sim_fundAccount", params: [account.address, "3000000000000000000"] });
  console.log("StudioNet faucet response", typeof result);
}
const receipts = proof.frontend_run ??= {
  origin, contract, signer: account.address, series: "LABELDESK-PORTAL-" + Date.now().toString(36).toUpperCase(),
  transactions: {},
};
assert.equal(receipts.signer, account.address);
assert.equal(receipts.origin, origin);
save();
const r1 = receipts.series + "-R1";
const r2 = receipts.series + "-R2";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => console.error(error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error(message.text().slice(0, 400)); });
  let step;
  await page.exposeBinding("labelDeskTestRequest", async ({ frame }, request) => {
    assert.equal(new URL(frame.url()).origin, origin);
    const { method, params } = request;
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
    if (method === "eth_chainId") return "0xf22f";
    if (method !== "eth_sendTransaction") {
      const allowed = new Set(["eth_blockNumber", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_getBalance", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash", "gen_getTransactionLifecycle"]);
      assert.ok(allowed.has(method), "Unexpected bridge method " + method);
      return chain.request({ method, params });
    }
    const [tx] = params;
    assert.ok(step && !step.tx_hash, "Unexpected or duplicate wallet write");
    assert.equal(tx.from.toLowerCase(), account.address.toLowerCase());
    assert.equal(tx.to.toLowerCase(), studionet.consensusMainContract.address.toLowerCase());
    assert.equal(tx.chainId, "0xf22f");
    const signed = await account.signTransaction({
      to: tx.to, data: tx.data, gas: BigInt(tx.gas), value: BigInt(tx.value),
      gasPrice: BigInt(tx.gasPrice), nonce: Number(BigInt(tx.nonce)), type: "legacy", chainId: 61999,
    });
    const hash = await chain.sendRawTransaction({ serializedTransaction: signed });
    step.tx_hash = hash;
    step.explorer_url = explorer + "/tx/" + hash;
    proof.evidence_entries.push({ type: "GenLayer Explorer Transaction", title: "Public frontend · " + step.action, url: step.explorer_url });
    save();
    console.log(step.action, hash);
    return hash;
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "ethereum", {
      value: { request: (request) => window.labelDeskTestRequest(request), on() {}, removeListener() {} },
    });
  });
  const response = await page.goto(origin + "/", { waitUntil: "load" });
  assert.equal(response.status(), 200);
  const button = (name) => page.getByRole("button", { name, exact: true });

  await button("Connect wallet").click();
  await delay(2000);
  if (!(await page.locator(".wallet-connected").isVisible())) console.log("Wallet UI:", (await page.locator("body").innerText()).slice(0, 1100));
  await page.locator(".wallet-connected").waitFor();
  const showForm = async (revision) => {
    if (!(await page.getByLabel("Release series ID").isVisible())) await button("Publish or open a revision").click();
    await page.getByLabel("Release series ID").fill(receipts.series);
    await page.locator(".publish-form select").selectOption(String(revision));
    await page.getByLabel(/Challenge window/).fill(revision === 1 ? "600" : "360");
  };
  const open = async (revision) => {
    await showForm(revision);
    await button("Open frozen revision").click();
    await page.locator(".release-revision").filter({ hasText: revision === 1 ? r1 : r2 }).waitFor();
  };
  async function run(action, click, expected = "FINISHED_WITH_RETURN") {
    const previously = receipts.transactions[action];
    if (previously && !previously.tx_hash) {
      throw new Error(action + " has no recorded hash. Inspect the signer nonce and app error before retrying.");
    }
    step = previously;
    if (!step) {
      step = receipts.transactions[action] = { action, initiated_at: new Date().toISOString() };
      save();
      await click();
      for (let i = 0; !step.tx_hash && i < 45; i++) {
        if (await page.locator(".notice--error").count()) throw new Error(await page.locator(".notice--error").first().innerText());
        await delay(1000);
      }
      assert.ok(step.tx_hash, action + " did not produce a transaction hash");
    }
    for (let i = 0; i < 90; i++) {
      const raw = await chain.getTransaction({ hash: step.tx_hash }).catch(() => null);
      if (raw) {
        const tx = decodeLocalnetTransaction(raw);
        if ((tx.status_name ?? tx.statusName) === "FINALIZED") {
          Object.assign(step, { status: tx.status_name ?? tx.statusName, consensus: tx.result_name, execution: tx.txExecutionResultName, validator_votes: tx.consensus_data?.votes, checked_at: new Date().toISOString() });
          save();
          assert.ok(["AGREE", "MAJORITY_AGREE"].includes(tx.result_name), "Validator disagreement retained in proof");
          assert.equal(tx.txExecutionResultName, expected);
          console.log(action, step.status, step.consensus, step.execution);
          await delay(6500);
          return step;
        }
      }
      await delay(5000);
    }
    throw new Error("Transaction still pending: " + step.tx_hash);
  }
  const publish = async (revision) => {
    await showForm(revision);
    await run("Publish R" + revision, () => button("Publish frozen revision").click());
    await open(revision);
    const release = await read("get_release", revision === 1 ? r1 : r2);
    assert.equal(release.dataset_id, receipts.series);
    await run("Approve R" + revision + " terms", () => button("Approve frozen terms").click());
    await open(revision);
    return release;
  };
  const select = (row) => page.getByRole("button", { name: new RegExp(row) }).click();
  const review = async (revision, row) => {
    await select(row);
    await run("Review R" + revision + " " + row, () => button("Review this row").click());
  };

  await publish(1);
  await review(1, "TKT-104");
  await review(1, "TKT-205");
  await review(1, "TKT-318");
  await select("TKT-205");
  await run("Challenge supported R1 label", async () => {
    await page.getByRole("button", { name: /Challenge this label/ }).click();
    await page.locator(".inline-form").getByRole("combobox").selectOption("NEW_REFUND_REQUEST");
    await page.getByRole("button", { name: "Submit challenge", exact: true }).click();
  });
  const challenge = await read("get_challenge", r1 + "-TKT-205");
  assert.equal(challenge.outcome, "REJECTED");
  receipts.challenge = challenge;
  const ambiguity = await run("Review R1 ambiguity", () => button("Review ambiguity example").click());
  const judgment = await read("get_judgment", r1, "TKT-427");
  assert.ok(judgment.finding?.explanation);
  receipts.ambiguity = { revision_id: r1, row_id: "TKT-427", ticket_text: "Any news about my refund?", judgment, transaction_hash: ambiguity.tx_hash, explorer_url: ambiguity.explorer_url };
  save();
  await page.getByRole("region", { name: "Ambiguity example" }).getByText(judgment.finding.verdict, { exact: true }).waitFor();
  const second = await publish(2);
  for (const row of ["TKT-104", "TKT-205", "TKT-318"]) await review(2, row);
  const waitMs = (second.challenge_cutoff + 2) * 1000 - Date.now();
  if (waitMs > 0) {
    console.log("Waiting for frozen R2 cutoff", new Date(second.challenge_cutoff * 1000).toISOString());
    await delay(waitMs);
  }
  await open(2);
  await run("Buyer accepts R2", () => button("Accept release").click());
  receipts.revision_one = await read("get_release", r1);
  receipts.revision_two = await read("get_release", r2);
  receipts.comparison = await read("get_comparison", r1, r2);
  assert.equal(receipts.revision_one.status, "FAILED");
  assert.equal(receipts.revision_two.status, "ACCEPTED");
  assert.equal(receipts.revision_two.sample_result.supported_rows, 3);
  receipts.verified_at = new Date().toISOString();
  save();
} finally {
  await browser.close();
}
