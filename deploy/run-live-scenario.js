import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { decodeLocalnetTransaction } from "genlayer-js";

const ROOT = process.cwd();
const PROOF_PATH = path.join(ROOT, "deploy", "proof.json");
const ROWS_PATH = path.join(ROOT, "data", "refund-tickets.json");
const RUBRIC_PATH = path.join(ROOT, "data", "refund-rubric.json");
const RELEASES_PATH = path.join(ROOT, "data", "featured-releases.json");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const proof = readJson(PROOF_PATH);
const CONTRACT = proof.contract.address;
const EXPLORER = proof.network.explorer_root;
const dataset = readJson(ROWS_PATH);
const rubric = readJson(RUBRIC_PATH);
const releases = readJson(RELEASES_PATH);
const live = (proof.transactions.live_decisions ??= {});
const addr = proof.roles.publisher;
let client;
const rowById = (rows, rowId) => rows.find((row) => row.rowId === rowId);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function releaseHashes(revisionId) {
  const rows = (revisionId === releases.revision_one_id ? dataset.revision_one : dataset.revision_two)
    .map((row) => ({ rowId: row.rowId, ticketText: row.ticketText, proposedLabel: row.proposedLabel }))
    .sort((left, right) => compareText(left.rowId, right.rowId));
  const sampleIds = [...dataset.sample_row_ids].sort(compareText);
  const normalizedRubric = {
    version: rubric.version,
    clauses: rubric.clauses.map((clause) => ({ id: clause.id, text: clause.text }))
      .sort((left, right) => compareText(left.id, right.id)),
  };
  return {
    content_digest: sha256(canonical(rows)),
    sample_digest: sha256(canonical(sampleIds.map((rowId) => ({ rowId, row: rowById(rows, rowId) })))),
    rubric_hash: sha256(canonical(normalizedRubric)),
  };
}

function evidenceFor(name, hash) {
  const url = `${EXPLORER}/tx/${hash}`;
  const exists = proof.evidence_entries.some((entry) => entry.url === url);
  if (!exists) {
    proof.evidence_entries.push({
      type: "GenLayer Explorer Transaction",
      title: name.replaceAll("_", " "),
      url,
    });
  }
  return url;
}

function stateFrom(tx) {
  const status = String(tx?.status_name ?? tx?.statusName ?? tx?.status ?? "").toUpperCase();
  const result = String(tx?.result_name ?? tx?.resultName ?? "").toUpperCase();
  const execution = String(tx?.txExecutionResultName ?? tx?.tx_execution_result_name ?? "").toUpperCase();
  const final = status === "FINALIZED" || status === "7";
  if (!final) return { state: status || "PENDING", status, result, execution };
  if (result.includes("DISAGREE") || result.includes("NO_CONSENSUS")) {
    return { state: "NO_CONSENSUS", status, result, execution };
  }
  if (["SUCCESS", "FINISHED_WITH_RETURN"].includes(execution)
    && (!result || ["AGREE", "MAJORITY_AGREE", "SUCCESS"].includes(result))) {
    return { state: "FINALIZED_SUCCESS", status, result, execution };
  }
  return { state: "FINALIZED_ERROR", status, result, execution };
}

async function record(name, functionName, args, expected = "FINALIZED_SUCCESS") {
  let item = live[name];
  if (item?.state === "LOCAL_SCRIPT_ERROR_NO_SUBMISSION") {
    delete live[name];
    writeJson(PROOF_PATH, proof);
    item = undefined;
  }
  if (item?.state === "FINALIZED_SUCCESS" || item?.state === "FINALIZED_ERROR" || item?.state === "NO_CONSENSUS") {
    console.log(`${name}: already recorded ${item.state} (${item.tx_hash ?? "no hash"}); not resubmitting`);
    if (item.expected !== expected || item.state !== expected) {
      throw new Error(`${name} is recorded as ${item.state} (expected ${expected}); no replacement transaction was submitted.`);
    }
    return item;
  }
  if (item && !item.tx_hash) {
    throw new Error(`${name} has an uncertain pre-hash submission record; inspect the StudioNet account before any retry.`);
  }

  if (!item) {
    item = live[name] = {
      action: functionName,
      expected,
      state: "PREPARING",
      revision_id: args[0],
      attempted_at: new Date().toISOString(),
      note: "One submission only; this record prevents blind retries.",
    };
    if (functionName === "publish_release") {
      item.cutoff_not_before = Math.floor(Date.now() / 1000) + Number(args[10]) + 45;
    }
    writeJson(PROOF_PATH, proof);
    try {
      const estimate = await client.estimateTransactionFees();
      const hash = await client.writeContract({
        address: CONTRACT,
        functionName,
        args,
        fees: {
          distribution: estimate.distribution,
          messageAllocations: estimate.messageAllocations,
          feeValue: estimate.feeValue,
        },
      });
      item.tx_hash = hash;
      item.explorer_url = evidenceFor(name, hash);
      item.state = "SUBMITTED";
      item.submitted_at = new Date().toISOString();
      writeJson(PROOF_PATH, proof);
    } catch (error) {
      item.state = "SUBMISSION_UNKNOWN";
      item.error = String(error?.message ?? error);
      writeJson(PROOF_PATH, proof);
      throw error;
    }
  }

  console.log(`${name}: ${item.tx_hash} submitted; waiting for finality`);
  try {
    await client.waitForTransactionReceipt({
      hash: item.tx_hash,
      waitUntil: "finalized",
      interval: 5000,
      retries: 180,
      fullTransaction: true,
    });
  } catch (error) {
    item.receipt_wait_error = String(error?.message ?? error);
  }
  const raw = await client.getTransaction({ hash: item.tx_hash });
  const decoded = raw
    ? stateFrom(decodeLocalnetTransaction(raw))
    : { state: "PENDING", status: "", result: "", execution: "" };
  item.state = decoded.state;
  item.status_name = decoded.status;
  item.result_name = decoded.result;
  item.execution_result = decoded.execution;
  item.finalized_at = item.state.startsWith("FINALIZED") || item.state === "NO_CONSENSUS"
    ? new Date().toISOString()
    : "";
  writeJson(PROOF_PATH, proof);
  console.log(`${name}: ${item.state}; result=${item.result_name || "not reported"}; execution=${item.execution_result || "not reported"}`);

  if (expected === "FINALIZED_ERROR") {
    if (item.state !== "FINALIZED_ERROR") throw new Error(`${name} expected a finalized business error, observed ${item.state}.`);
  } else if (item.state !== expected) {
    throw new Error(`${name} expected ${expected}, observed ${item.state}. Transaction is recorded; no retry was made.`);
  }
  return item;
}

function publishArgs(revisionId, revision, parent, rows, window) {
  if (typeof revisionId !== "string" || !revisionId || !Array.isArray(rows) || rows.length < 3) {
    throw new Error(`Refusing publish with missing revision ID or frozen rows (revision=${String(revisionId)}, rows=${Array.isArray(rows) ? rows.length : "missing"}).`);
  }
  return [
    revisionId,
    dataset.dataset_id,
    revision,
    parent,
    JSON.stringify(rows),
    JSON.stringify(dataset.sample_row_ids),
    JSON.stringify(rubric),
    dataset.threshold,
    addr,
    addr,
    window,
  ];
}

async function approve(revisionId) {
  const expected = releaseHashes(revisionId);
  const result = await record(`approve_${revisionId}`, "approve_terms", [
    revisionId,
    expected.content_digest,
    expected.sample_digest,
    expected.rubric_hash,
  ]);
  result.expected_digests = expected;
  writeJson(PROOF_PATH, proof);
  return result;
}

async function pauseUntil(timestampSeconds, label) {
  const until = timestampSeconds * 1000;
  while (Date.now() <= until) {
    const remaining = Math.ceil((until - Date.now()) / 1000);
    console.log(`${label}: challenge cutoff in ${remaining}s`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, Math.max(1000, until - Date.now() + 1))));
  }
}

export default async function runLiveScenario(providedClient) {
  client = providedClient;
  if (!client || typeof client.writeContract !== "function" || typeof client.estimateTransactionFees !== "function") {
    throw new Error("The GenLayer CLI did not provide the fee-aware client methods required by this live script.");
  }
  const ids = releases;
  if (proof.contract.address.toLowerCase() !== CONTRACT.toLowerCase()) throw new Error("Proof contract address does not match the live script.");
  if (addr !== proof.roles.buyer || addr !== proof.roles.reviewer) throw new Error("This script expects the currently recorded single-wallet live role setup.");
  if (proof.live_verification.release_ids_preflight_contract !== CONTRACT
    || !Array.isArray(proof.live_verification.release_ids_before_r1_retry)
    || proof.live_verification.release_ids_before_r1_retry.includes(ids.revision_one_id)) {
    throw new Error("A matching read-only CLI preflight proving revision 1 absent is required before publication.");
  }

  console.log("LabelDesk live scenario on GenLayer StudioNet (synthetic data). Wallet key stays inside the CLI.");
  await record("publish_revision_one", "publish_release", publishArgs(
    ids.revision_one_id,
    1,
    "",
    dataset.revision_one,
    ids.challenge_window_seconds,
  ));
  await approve(ids.revision_one_id);

  await record("review_r1_TKT_104", "review_row", [ids.revision_one_id, "TKT-104"]);
  await record("challenge_r1_reuse_TKT_104", "submit_challenge", [
    "CH-R1-104",
    ids.revision_one_id,
    "TKT-104",
    "REFUND_STATUS",
  ]);
  await record("challenge_r1_first_judgment_TKT_205", "submit_challenge", [
    "CH-R1-205",
    ids.revision_one_id,
    "TKT-205",
    "NEW_REFUND_REQUEST",
  ]);

  await pauseUntil(live.publish_revision_one.cutoff_not_before, "Revision 1");
  await record("adjudicate_challenge_r1_TKT_205", "adjudicate_challenge", ["CH-R1-205"]);
  await record("review_r1_TKT_318", "review_row", [ids.revision_one_id, "TKT-318"]);
  const failedAccept = await record(
    "revision_one_acceptance_attempt",
    "accept_release",
    [ids.revision_one_id],
    "FINALIZED_ERROR",
  );
  failedAccept.expected_error = "SAMPLE_CONTAINS_INCORRECT_OR_INSUFFICIENT_FINDING";
  failedAccept.note = "Expected buyer rejection: the target row was finally adjudicated LABEL_INCORRECT; revision 1 remains failed with no receipt.";
  proof.transactions.revision_one_acceptance_attempt = failedAccept.tx_hash;
  writeJson(PROOF_PATH, proof);

  await record("publish_revision_two", "publish_release", publishArgs(
    ids.revision_two_id,
    2,
    ids.revision_one_id,
    dataset.revision_two,
    ids.challenge_window_seconds,
  ));
  await approve(ids.revision_two_id);
  await record("review_r2_TKT_104", "review_row", [ids.revision_two_id, "TKT-104"]);
  await record("review_r2_TKT_205", "review_row", [ids.revision_two_id, "TKT-205"]);
  await record("review_r2_TKT_318", "review_row", [ids.revision_two_id, "TKT-318"]);
  await pauseUntil(live.publish_revision_two.cutoff_not_before, "Revision 2");
  const accepted = await record("revision_two_acceptance", "accept_release", [ids.revision_two_id]);
  proof.transactions.revision_two_acceptance = accepted.tx_hash;
  writeJson(PROOF_PATH, proof);

  proof.live_verification.status = "LIVE_TRANSACTIONS_FINALIZED_WAITING_FOR_READ_VERIFICATION";
  proof.live_verification.checked_at = new Date().toISOString();
  proof.live_verification.note = "All scenario writes finalized once per unique evidence item. On-chain release, challenge, comparison, and receipt views still require read-only verification. Synthetic ticket text only.";
  writeJson(PROOF_PATH, proof);
  console.log("LIVE_WRITES_COMPLETE; finish with read-only CLI calls listed in docs/WORKBENCH.md.");
  console.log(JSON.stringify(Object.fromEntries(Object.entries(live).map(([name, item]) => [name, {
    state: item.state,
    hash: item.tx_hash,
    result: item.result_name,
    execution: item.execution_result,
  }])), null, 2));
}
