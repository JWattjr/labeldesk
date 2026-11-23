import fs from "node:fs";
import path from "node:path";
import { decodeLocalnetTransaction } from "genlayer-js";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const PROOF_PATH = path.join(PROJECT_ROOT, "deploy", "proof.json");
const CONTRACT_PATH = path.join(PROJECT_ROOT, "contracts", "labeldesk.py");
const EXPLORER_ROOT = "https://explorer-studio.genlayer.com";
const ATTEMPT_ID = "final-contract-fee-aware";

const readProof = () => JSON.parse(fs.readFileSync(PROOF_PATH, "utf8"));
const writeProof = (proof) => fs.writeFileSync(PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`, "utf8");

function stateFrom(raw) {
  if (!raw) return { state: "PENDING", status: "", result: "", execution: "" };
  const tx = decodeLocalnetTransaction(raw);
  const status = String(tx.status_name ?? tx.statusName ?? tx.status ?? "").toUpperCase();
  const result = String(tx.result_name ?? tx.resultName ?? "").toUpperCase();
  const execution = String(tx.txExecutionResultName ?? tx.tx_execution_result_name ?? "").toUpperCase();
  if (status !== "FINALIZED" && status !== "7") return { state: status || "PENDING", status, result, execution };
  if (result.includes("DISAGREE") || result.includes("NO_CONSENSUS")) return { state: "NO_CONSENSUS", status, result, execution };
  return ["SUCCESS", "FINISHED_WITH_RETURN"].includes(execution)
    ? { state: "FINALIZED_SUCCESS", status, result, execution }
    : { state: "FINALIZED_ERROR", status, result, execution };
}

export default async function deployFinalContract(client) {
  if (!client || typeof client.deployContract !== "function" || typeof client.estimateTransactionFees !== "function") {
    throw new Error("The GenLayer CLI client lacks the fee-aware deploy and estimate methods; no deployment was submitted.");
  }
  const proof = readProof();
  const history = proof.deployment_history.find((entry) => entry.deployment_id === ATTEMPT_ID);
  if (!history || history.status !== "READY") throw new Error("The deployment attempt is not explicitly READY; no retry or duplicate was submitted.");
  const fees = await client.estimateTransactionFees();
  if (!fees?.distribution || BigInt(fees.feeValue ?? 0) <= 0n) {
    throw new Error("Fee estimation did not produce a nonzero deposit; no deployment was submitted.");
  }
  const code = fs.readFileSync(CONTRACT_PATH, "utf8");
  history.status = "PREPARING";
  history.submitted_at = new Date().toISOString();
  history.fee_value = String(fees.feeValue);
  history.note = "Fee-aware CLI client estimates and attaches the signed StudioNet deposit. One submission only; a missing hash is treated as uncertain and is never retried automatically.";
  writeProof(proof);

  let hash;
  try {
    hash = await client.deployContract({ code, leaderOnly: false, fees });
  } catch (error) {
    history.status = "SUBMISSION_UNKNOWN";
    history.error = String(error?.message ?? error);
    writeProof(proof);
    throw error;
  }

  history.tx_hash = hash;
  history.status = "SUBMITTED";
  history.explorer_url = `${EXPLORER_ROOT}/tx/${hash}`;
  proof.evidence_entries.push({ type: "GenLayer Explorer Transaction", title: "Final LabelDesk deployment transaction", url: history.explorer_url });
  writeProof(proof);

  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash, waitUntil: "finalized", interval: 5000, retries: 180, fullTransaction: true });
  } catch (error) {
    history.receipt_wait_error = String(error?.message ?? error);
  }
  const raw = await client.getTransaction({ hash });
  const state = stateFrom(raw);
  history.status = state.state;
  history.status_name = state.status;
  history.result_name = state.result;
  history.execution_result = state.execution;
  history.finalized_at = state.state === "FINALIZED_SUCCESS" || state.state === "FINALIZED_ERROR" || state.state === "NO_CONSENSUS"
    ? new Date().toISOString()
    : "";
  const address = receipt?.data?.contract_address
    ?? receipt?.txDataDecoded?.contractAddress
    ?? receipt?.contract_address
    ?? raw?.data?.contract_address
    ?? raw?.txDataDecoded?.contractAddress;
  if (state.state !== "FINALIZED_SUCCESS" || typeof address !== "string" || !/^0x[0-9a-f]{40}$/i.test(address)) {
    history.note = `Deployment ended ${state.state}; no retry was made. Address must be read from the finalized receipt if it is not exposed in the client response.`;
    writeProof(proof);
    throw new Error(`Fee-aware deployment ended ${state.state}; inspect its single receipt before taking any further action.`);
  }

  const addressUrl = `${EXPLORER_ROOT}/address/${address}`;
  proof.contract = {
    ...proof.contract,
    address,
    explorer_url: addressUrl,
    explorer_verified: false,
    name: "LabelDesk",
    source: "contracts/labeldesk.py",
    runner: proof.contract.runner,
  };
  proof.deployment_history.push({
    contract_address: address,
    tx_hash: hash,
    status: "FINALIZED_SUCCESS",
    explorer_url: addressUrl,
    runner: proof.contract.runner,
    note: "Active immutable deployment containing the expired-closure status fix.",
  });
  proof.evidence_entries.push({ type: "GenLayer Explorer Contract", title: "Active LabelDesk contract (StudioNet)", url: addressUrl, verified: false });
  proof.transactions = {
    revision_one_acceptance_attempt: "",
    revision_two_acceptance: "",
    live_decisions: {},
    deployment_final_contract: hash,
  };
  proof.live_verification = {
    status: "DEPLOYED_WAITING_FOR_PRODUCT_TRANSACTIONS",
    checked_at: new Date().toISOString(),
    release_ids_preflight_contract: address,
    release_ids_before_r1_retry: null,
    note: "Final deployment finalized; a read-only release-ID preflight is still required before live scenario writes.",
  };
  writeProof(proof);
  console.log(JSON.stringify({ status: state.state, result: state.result, execution: state.execution, hash, contract_address: address, explorer_url: addressUrl }));
}
