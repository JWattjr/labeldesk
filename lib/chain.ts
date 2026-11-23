import { createClient, decodeLocalnetTransaction } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant, type TransactionHash } from "genlayer-js/types";
import proof from "@/deploy/proof.json";
import type { AcceptanceReceipt, Judgment, Release, Scenario, TicketRow } from "@/lib/domain";
import { getSyntheticScenario } from "@/lib/domain";

export const STUDIO_RPC = "https://studio.genlayer.com/api";
export const STUDIO_EXPLORER = "https://explorer-studio.genlayer.com";
export const STUDIO_CHAIN_ID = 61999;
const STUDIO_CHAIN_HEX = "0xf22f";
const client = createClient({ chain: studionet, endpoint: STUDIO_RPC });

type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Provider;
  }
}

export type WalletSession = {
  account: string;
  client: ReturnType<typeof createClient>;
};

export type TransactionStatus =
  | "SUBMISSION_FAILED"
  | "SUBMITTED"
  | "PENDING"
  | "ACCEPTED"
  | "FINALIZED_SUCCESS"
  | "FINALIZED_ERROR"
  | "NO_CONSENSUS";

export type TransactionProgress = {
  hash: string;
  label: string;
  status: TransactionStatus;
  message: string;
};

export function contractAddress(): string {
  return process.env.NEXT_PUBLIC_LABELDESK_CONTRACT_ADDRESS || proof.contract.address || "";
}

export async function connectWallet(onSubmitted?: (hash: string) => void): Promise<WalletSession> {
  const injected = window.ethereum;
  if (!injected) throw new Error("Install a compatible wallet to submit review actions.");
  const accounts = await injected.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts[0]) throw new Error("Select an account in your wallet.");
  const currentChain = await injected.request({ method: "eth_chainId" });
  if (currentChain !== STUDIO_CHAIN_HEX) {
    try {
      await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: STUDIO_CHAIN_HEX }] });
    } catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: STUDIO_CHAIN_HEX,
          chainName: "GenLayer StudioNet",
          nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
          rpcUrls: [STUDIO_RPC],
          blockExplorerUrls: [STUDIO_EXPLORER],
        }],
      });
    }
  }
  const provider: Provider = {
    request: async (args) => {
      if (args.method === "eth_sendTransaction") {
        const tx = args.params?.[0] as Record<string, unknown>;
        const hash = await injected.request({
          ...args,
          params: [{
            ...tx,
            chainId: STUDIO_CHAIN_HEX,
            type: "0x0",
            gasPrice: tx.gasPrice ?? "0x3b9aca00",
            value: tx.value ?? "0x0",
          }],
        });
        if (typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash)) onSubmitted?.(hash);
        return hash;
      }
      return injected.request(args);
    },
  };
  return {
    account: accounts[0].toLowerCase(),
    client: createClient({ chain: studionet, account: accounts[0] as `0x${string}`, provider }),
  };
}

function parseValue<T>(value: unknown): T {
  if (typeof value === "string" && /^[\[{]/.test(value)) return JSON.parse(value) as T;
  return value as T;
}

function hasAcceptanceReceipt(value: Release["acceptance_receipt"]): value is AcceptanceReceipt {
  return typeof value === "object" && value !== null && "receipt_id" in value;
}

export async function readRelease(revisionId: string): Promise<Release> {
  const address = contractAddress();
  if (!address) throw new Error("No deployed LabelDesk contract is recorded.");
  const result = await client.readContract({
    address: address as `0x${string}`,
    functionName: "get_release",
    args: [revisionId],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  const release = parseValue<Release>(result);
  const judgments: Release["judgments"] = {};
  for (const { rowId } of release.rows) {
    const raw = await client.readContract({
      address: address as `0x${string}`,
      functionName: "get_judgment",
      args: [revisionId, rowId],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    });
    const value = parseValue<unknown>(raw);
    if (!value || typeof value !== "object" || !("finding" in value) || !("binding" in value)) continue;
    const judgment = value as Judgment;
    const frozenRow = release.rows.find((row) => row.rowId === rowId);
    if (
      frozenRow &&
      judgment.binding.revision_id === revisionId &&
      judgment.binding.row_id === rowId &&
      judgment.binding.proposed_label === frozenRow.proposedLabel &&
      judgment.binding.content_digest === release.content_digest
    ) {
      judgments[rowId] = judgment;
    }
  }
  return { ...release, judgments };
}

export async function loadScenario(): Promise<Scenario> {
  const address = contractAddress();
  if (!address) return getSyntheticScenario();
  const fallback = getSyntheticScenario();
  try {
    const [revisionOne, revisionTwo] = await Promise.all([
      readRelease(fallback.revisionOne.revision_id),
      readRelease(fallback.revisionTwo.revision_id),
    ]);
    const failedAttempt = proof.transactions.revision_one_acceptance_attempt;
    const acceptanceHash = proof.transactions.revision_two_acceptance;
    const revisionTwoWithReceipt = acceptanceHash && hasAcceptanceReceipt(revisionTwo.acceptance_receipt)
      ? {
          ...revisionTwo,
          acceptance_receipt: {
            ...revisionTwo.acceptance_receipt,
            transaction_hash: acceptanceHash,
            explorer_url: `${STUDIO_EXPLORER}/tx/${acceptanceHash}`,
          },
        }
      : revisionTwo;
    return {
      source: "live-contract",
      sourceNote: "Live contract state on GenLayer StudioNet. Synthetic ticket text only.",
      revisionOne,
      revisionTwo: revisionTwoWithReceipt,
      changedRowId: "TKT-104",
      failedAcceptanceAttempt: failedAttempt ? {
        status: "FAILED",
        reason: "SAMPLE_CONTAINS_INCORRECT_OR_INSUFFICIENT_FINDING",
        transactionHash: failedAttempt,
        explorerUrl: `${STUDIO_EXPLORER}/tx/${failedAttempt}`,
      } : null,
    };
  } catch (error) {
    return {
      ...fallback,
      source: "live-unavailable",
      sourceNote: `Live contract read unavailable: ${(error as Error).message}. Showing the clearly labeled synthetic preview.`,
    };
  }
}

/**
 * The public comparison uses a read-verified snapshot when browser RPC reads
 * are unavailable. Its outcomes and receipt are sourced from deploy/proof.json;
 * ticket and rubric text remain explicitly synthetic fixtures.
 */
export function getVerifiedScenarioSnapshot(): Scenario {
  const verification = proof.live_verification;
  const observations = verification?.observations;
  const address = contractAddress();
  if (
    verification?.status !== "LIVE_VERIFIED" ||
    !observations ||
    observations.contract_address !== address
  ) {
    return getSyntheticScenario();
  }

  const scenario = getSyntheticScenario();
  const r1 = scenario.revisionOne;
  const r2 = scenario.revisionTwo;
  const comparison = observations.comparison;
  const expectedR1 = proof.transactions.live_decisions["approve_LABELDESK-REFUNDS-R1"]?.expected_digests;
  const expectedR2 = proof.transactions.live_decisions["approve_LABELDESK-REFUNDS-R2"]?.expected_digests;
  const receiptTx = proof.transactions.revision_two_acceptance;
  const failedTx = proof.transactions.revision_one_acceptance_attempt;
  const roles = proof.roles;
  const challengeObservations = observations.challenges;
  const accepted = observations.revision_two;
  const publishedOne = 1795458162;
  const publishedTwo = 1795458952;

  if (!expectedR1 || !expectedR2 || !receiptTx || !failedTx || !comparison || !accepted) {
    return scenario;
  }

  for (const release of [r1, r2]) {
    release.sample_ids = [...comparison.common_sample_ids];
    release.rubric_hash = expectedR1.rubric_hash;
    release.terms_approved = true;
    // Snapshot rows are summarized below; do not present preview judgments as
    // if they were the contract's full finalized finding payloads.
    release.judgments = {};
    delete release.example_judgment;
  }

  Object.assign(r1, {
    content_digest: expectedR1.content_digest,
    sample_digest: expectedR1.sample_digest,
    published_at: publishedOne,
    challenge_cutoff: publishedOne + 600,
    status: observations.revision_one.status,
    sample_result: {
      sampled_rows: observations.revision_one.sampled_rows,
      adjudicated_rows: observations.revision_one.sampled_rows,
      supported_rows: observations.revision_one.supported_rows,
      unsupported_rows: observations.revision_one.unsupported_rows,
      threshold: observations.revision_one.threshold,
      open_challenges: 0,
    },
    acceptance_receipt: {},
    challenges: r1.challenges.map((item, index) => {
      const liveChallenge = challengeObservations[index];
      return liveChallenge ? {
        ...item,
        challenge_id: liveChallenge.challenge_id,
        outcome: liveChallenge.outcome,
        finding_id: liveChallenge.finding_id,
        resolution_basis: liveChallenge.resolution_basis,
      } : item;
    }),
  });

  Object.assign(r2, {
    content_digest: expectedR2.content_digest,
    sample_digest: expectedR2.sample_digest,
    published_at: publishedTwo,
    challenge_cutoff: accepted.challenge_cutoff,
    status: observations.revision_two.status,
    sample_result: {
      sampled_rows: observations.revision_two.sampled_rows,
      adjudicated_rows: observations.revision_two.sampled_rows,
      supported_rows: observations.revision_two.supported_rows,
      unsupported_rows: observations.revision_two.unsupported_rows,
      threshold: observations.revision_two.threshold,
      open_challenges: 0,
    },
    acceptance_receipt: {
      receipt_id: accepted.acceptance_receipt_id,
      revision_id: r2.revision_id,
      buyer: roles.buyer,
      accepted_at: accepted.accepted_at,
      sampled_rows: accepted.sampled_rows,
      supported_rows: accepted.supported_rows,
      status: "ACCEPTED_BY_BUYER",
      transaction_hash: receiptTx,
      explorer_url: `${STUDIO_EXPLORER}/tx/${receiptTx}`,
    },
  });

  const r1Verdicts = {
    "TKT-104": "LABEL_INCORRECT",
    "TKT-205": "LABEL_SUPPORTED",
    "TKT-318": "LABEL_SUPPORTED",
  } as const;
  const r2Verdicts = {
    "TKT-104": "LABEL_SUPPORTED",
    "TKT-205": "LABEL_SUPPORTED",
    "TKT-318": "LABEL_SUPPORTED",
  } as const;

  return {
    ...scenario,
    source: "live-contract",
    sourceNote: `Read-verified StudioNet contract snapshot checked ${verification.checked_at}. Ticket text, labels, and rubric are synthetic fixtures.`,
    revisionOne: r1,
    revisionTwo: r2,
    changedRowId: comparison.row_id,
    verifiedSnapshot: {
      checkedAt: verification.checked_at,
      chainId: observations.chain_id,
      contractAddress: observations.contract_address,
      revisionOneVerdicts: r1Verdicts,
      revisionTwoVerdicts: r2Verdicts,
    },
    failedAcceptanceAttempt: {
      status: "FAILED",
      reason: observations.revision_one.failed_acceptance_reason,
      transactionHash: failedTx,
      explorerUrl: `${STUDIO_EXPLORER}/tx/${failedTx}`,
    },
  };
}

function transactionState(raw: Record<string, unknown>): TransactionStatus {
  const consensus = raw.consensus_data as { leader_receipt?: { execution_result?: string }[] } | undefined;
  const status = String(raw.status_name ?? raw.statusName ?? raw.status ?? "");
  const resultName = String(raw.result_name ?? raw.resultName ?? "");
  if (status === "FINALIZED" || status === "7") {
    if (resultName.includes("DISAGREE") || resultName.includes("NO_CONSENSUS")) return "NO_CONSENSUS";
    const execution = String(raw.txExecutionResultName ?? consensus?.leader_receipt?.[0]?.execution_result ?? "");
    return ["SUCCESS", "FINISHED_WITH_RETURN"].includes(execution)
      && (!resultName || ["AGREE", "MAJORITY_AGREE", "SUCCESS"].includes(resultName))
      ? "FINALIZED_SUCCESS"
      : "FINALIZED_ERROR";
  }
  if (status === "ACCEPTED" || status === "6") return "ACCEPTED";
  return status ? "PENDING" : "SUBMITTED";
}

export async function estimateTransactionFees(session: WalletSession) {
  const estimate = await session.client.estimateTransactionFees();
  return {
    distribution: estimate.distribution,
    messageAllocations: estimate.messageAllocations,
    feeValue: estimate.feeValue,
  };
}

export async function waitForTransaction(
  session: WalletSession,
  hash: string,
  label: string,
  onProgress: (progress: TransactionProgress) => void,
): Promise<TransactionStatus> {
  let status: TransactionStatus = "SUBMITTED";
  const messages: Record<TransactionStatus, string> = {
    SUBMISSION_FAILED: "The wallet did not return a transaction hash. No judgment was recorded.",
    SUBMITTED: "Submitted to StudioNet. No finding is recorded yet.",
    PENDING: "Pending consensus. No finding is recorded yet.",
    ACCEPTED: "Accepted and waiting for finality. No finding is recorded yet.",
    FINALIZED_SUCCESS: "Transaction finalized successfully. Refreshing the contract state.",
    FINALIZED_ERROR: "Transaction finalized with an execution error. No new finding was stored.",
    NO_CONSENSUS: "Validators did not reach consensus. This is not an INSUFFICIENT finding.",
  };
  const message = (state: TransactionStatus) => messages[state];
  onProgress({ hash, label, status, message: message(status) });
  for (let attempt = 0; attempt < 36; attempt += 1) {
    try {
      const raw = await session.client.getTransaction({ hash: hash as TransactionHash });
      if (raw) {
        const decoded = decodeLocalnetTransaction(raw as never) as unknown as Record<string, unknown>;
        status = transactionState(decoded);
        onProgress({ hash, label, status, message: message(status) });
        if (["FINALIZED_SUCCESS", "FINALIZED_ERROR", "NO_CONSENSUS"].includes(status)) return status;
      }
    } catch {
      // Keep the signed hash and retry; an indexer delay is not a judgment.
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return status;
}

export function rowArgs(rows: TicketRow[]): string {
  return JSON.stringify(rows);
}
