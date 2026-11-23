import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const manifest = new URL("./proof.json", import.meta.url);
const proofText = readFileSync(manifest, "utf8");
const proof = JSON.parse(proofText);
const docs = ["../README.md", "../docs/portal.md"].map((path) => {
  const url = new URL(path, import.meta.url);
  try { return readFileSync(url, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
});
const evidence = [...new Set([proofText, ...docs].flatMap((text) => (
  [...text.matchAll(/https:\/\/explorer-studio\.genlayer\.com\/(tx|address)\/(0x[a-fA-F0-9]+)/g)].map((match) => match[0])
)))].sort();
const chain = createClient({ chain: studionet });
assert.equal(await chain.request({ method: "eth_chainId" }), "0xf22f");
const cache = new URL("../receipts/explorer-verification.json", import.meta.url);
const previous = existsSync(cache) ? JSON.parse(readFileSync(cache, "utf8")) : proof.explorer_verification;
const results = (previous?.results ?? []).filter(({ url, verified }) => verified && evidence.includes(url));
for (const url of evidence) {
  if (results.some((result) => result.url === url)) continue;
  const [, type, hash] = new URL(url).pathname.split("/");
  const result = { url, chain_id: 61999 };
  try {
    const page = await fetch(url, { signal: AbortSignal.timeout(20000) });
    result.http_status = page.status;
    const html = await page.text();
    assert.ok(page.ok && html.includes("GenLayer Studio Explorer"));
    assert.ok(html.toLowerCase().includes(hash.toLowerCase()));
    if (type === "address") {
      const schema = await chain.getContractSchema(hash);
      assert.ok(JSON.stringify(schema).includes("get_release"), "Expected the LabelDesk schema");
      result.api = "gen_getContractSchema";
    } else {
      const tx = await chain.getTransaction({ hash });
      assert.ok(tx && Object.keys(tx).length, "No StudioNet transaction for hash");
      result.api = "eth_getTransactionByHash";
    }
    result.verified = true;
  } catch (error) {
    result.verified = false;
    result.reason = error.message;
  }
  results.push(result);
  console.log(result.verified ? "verified" : "unverified", url, result.reason ?? "");
  await delay(1250);
}
// The frontend test can add evidence while this process runs. Commit only
// results from the verified URL set to the latest manifest.
const latest = JSON.parse(readFileSync(manifest, "utf8"));
latest.explorer_verification = { checked_at: new Date().toISOString(), endpoint: "https://studio.genlayer.com/api", results };
mkdirSync(new URL("../receipts/", import.meta.url), { recursive: true });
writeFileSync(cache, JSON.stringify(latest.explorer_verification, null, 2));
writeFileSync(manifest, JSON.stringify(latest, null, 2) + "\n");
if (results.some(({ verified }) => !verified)) process.exitCode = 1;
