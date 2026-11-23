import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const proof = JSON.parse(readFileSync(new URL("../deploy/proof.json", import.meta.url), "utf8"));
const { origin, ambiguity } = proof.frontend_run;
assert.ok(ambiguity, "Missing finalized browser ambiguity evidence");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of ["/", "/compare"]) {
      const response = await page.goto(origin + route, { waitUntil: "load" });
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { level: 1 }).waitFor();
      console.log(viewport.width, route, response.status());
    }
    await page.getByText("3 of 3 sampled rows supported", { exact: true }).waitFor();
    await page.getByText("Still FAILED", { exact: true }).waitFor();
    const example = page.getByRole("region", { name: "Live ambiguity example" });
    await example.getByText(ambiguity.judgment.finding.verdict, { exact: true }).waitFor();
    assert.ok((await example.innerText()).includes(ambiguity.judgment.finding.explanation));
    assert.equal(await example.getByRole("link").getAttribute("href"), ambiguity.explorer_url);
    if (ambiguity.validator_votes) assert.match(await example.innerText(), /3 agreed, 2 disagreed/);
    assert.deepEqual(errors, []);
    await page.close();
  }
  const run = proof.frontend_run;
  if (run.verified_at) {
    const page = await browser.newPage();
    await page.addInitScript((address) => {
      Object.defineProperty(window, "ethereum", {
        value: { request: async ({ method }) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
          if (method === "eth_chainId") return "0xf22f";
          throw new Error("Read-only verification provider");
        } },
      });
    }, run.signer);
    await page.goto(origin + "/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
    await page.getByRole("button", { name: "Publish or open a revision", exact: true }).click();
    await page.getByLabel("Release series ID").fill(run.series);
    for (const [revision, status] of [["1", "Failed"], ["2", "Accepted by buyer"]]) {
      await page.locator(".publish-form select").selectOption(revision);
      await page.getByRole("button", { name: "Open frozen revision", exact: true }).click();
      const release = page.locator(".release-bar").filter({ hasText: run.series + "-R" + revision });
      await release.getByText(status, { exact: true }).waitFor();
    }
    await page.getByText(run.revision_two.acceptance_receipt.receipt_id, { exact: false }).waitFor();
    console.log("Public workbench displayed both fresh release states and the accepted receipt");
    await page.close();
  }
} finally {
  await browser.close();
}
