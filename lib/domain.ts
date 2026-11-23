import dataset from "@/data/refund-tickets.json";
import rubricDocument from "@/data/refund-rubric.json";
import featured from "@/data/featured-releases.json";

export type Verdict = "LABEL_SUPPORTED" | "LABEL_INCORRECT" | "INSUFFICIENT";
export type ChallengeOutcome = "UPHELD" | "REJECTED" | "UNRESOLVED";
export type Label = "NEW_REFUND_REQUEST" | "REFUND_STATUS";

export type TicketRow = {
  rowId: string;
  ticketText: string;
  proposedLabel: Label;
};

export type RubricClause = { id: string; text: string };
export type Finding = {
  finding_id: string;
  verdict: Verdict;
  explanation: string;
  evidence_excerpt: string;
  source_revision_id: string;
  finalized_at: number;
};
export type Judgment = {
  binding: {
    revision_id: string;
    row_id: string;
    proposed_label: Label;
    content_digest: string;
    rubric_hash: string;
    finding_id: string;
    source_revision_id: string;
    reused_finding: boolean;
  };
  finding: Finding;
};
export type Challenge = {
  challenge_id: string;
  revision_id: string;
  row_id: string;
  proposed_label: Label;
  ticket_text: string;
  rubric_clause_id: string;
  rubric_clause_text: string;
  status: "OPEN" | "FINALIZED" | "EXPIRED";
  outcome: ChallengeOutcome | "";
  finding_id: string;
  resolution_basis: string;
};
export type AcceptanceReceipt = {
  receipt_id: string;
  revision_id: string;
  buyer: string;
  accepted_at: number;
  sampled_rows: number;
  supported_rows: number;
  status: "ACCEPTED_BY_BUYER";
  transaction_hash?: string;
  explorer_url?: string;
};
export type Release = {
  revision_id: string;
  dataset_id: string;
  revision_number: number;
  parent_revision_id: string;
  publisher: string;
  buyer: string;
  reviewer: string;
  rows: TicketRow[];
  sample_ids: string[];
  rubric: { version: string; clauses: RubricClause[] };
  rubric_hash: string;
  threshold: number;
  content_digest: string;
  sample_digest: string;
  published_at: number;
  challenge_cutoff: number;
  terms_approved: boolean;
  terms_receipt: Record<string, unknown>;
  status: "AWAITING_BUYER_APPROVAL" | "REVIEWING" | "ELIGIBLE" | "FAILED" | "ACCEPTED";
  sample_result: {
    sampled_rows: number;
    adjudicated_rows: number;
    supported_rows: number;
    unsupported_rows: number;
    threshold: number;
    open_challenges: number;
  };
  challenges: Challenge[];
  closed_at: number;
  closure_reason: string;
  acceptance_receipt: AcceptanceReceipt | Record<string, never>;
  judgments: Record<string, Judgment>;
  example_judgment?: Judgment;
};

export type Scenario = {
  source: "synthetic-preview" | "live-contract" | "live-unavailable";
  sourceNote: string;
  revisionOne: Release;
  revisionTwo: Release;
  changedRowId: string;
  verifiedSnapshot?: {
    checkedAt: string;
    chainId: number;
    contractAddress: string;
    revisionOneVerdicts: Record<string, Verdict>;
    revisionTwoVerdicts: Record<string, Verdict>;
  };
  failedAcceptanceAttempt: {
    status: "FAILED";
    reason: string;
    transactionHash?: string;
    explorerUrl?: string;
  } | null;
};

const rowsOne = dataset.revision_one as TicketRow[];
const rowsTwo = dataset.revision_two as TicketRow[];
const sampleIds = [...dataset.sample_row_ids].sort();
const rubric = rubricDocument as { version: string; clauses: RubricClause[] };
const at = Math.floor(Date.UTC(2026, 10, 23, 12, 0, 0) / 1000);

function finding(
  id: string,
  verdict: Verdict,
  explanation: string,
  excerpt: string,
  sourceRevisionId: string,
): Finding {
  return {
    finding_id: id,
    verdict,
    explanation,
    evidence_excerpt: excerpt,
    source_revision_id: sourceRevisionId,
    finalized_at: at,
  };
}

function bind(
  revisionId: string,
  row: TicketRow,
  result: Finding,
  contentDigest: string,
  reused = false,
): Judgment {
  return {
    binding: {
      revision_id: revisionId,
      row_id: row.rowId,
      proposed_label: row.proposedLabel,
      content_digest: contentDigest,
      rubric_hash: "synthetic-preview-rubric-hash",
      finding_id: result.finding_id,
      source_revision_id: result.source_revision_id,
      reused_finding: reused,
    },
    finding: result,
  };
}

function challenge(
  id: string,
  revisionId: string,
  row: TicketRow,
  clause: RubricClause,
  outcome: ChallengeOutcome,
  findingId: string,
): Challenge {
  return {
    challenge_id: id,
    revision_id: revisionId,
    row_id: row.rowId,
    proposed_label: row.proposedLabel,
    ticket_text: row.ticketText,
    rubric_clause_id: clause.id,
    rubric_clause_text: clause.text,
    status: "FINALIZED",
    outcome,
    finding_id: findingId,
    resolution_basis: "REUSED_FINALIZED_MATCHING_FINDING",
  };
}

const findings = {
  wrong: finding(
    "JF-PREVIEW-TKT104-R1",
    "LABEL_INCORRECT",
    "The customer asks about the arrival of a refund that was already approved, so this is refund status rather than a request to initiate one.",
    "refund you approved on Tuesday",
    featured.revision_one_id,
  ),
  broken: finding(
    "JF-PREVIEW-TKT205",
    "LABEL_SUPPORTED",
    "The customer asks the merchant to initiate a refund because the item arrived broken.",
    "item arrived broken",
    featured.revision_one_id,
  ),
  paraphrase: finding(
    "JF-PREVIEW-TKT318",
    "LABEL_SUPPORTED",
    "The customer asks when an already promised return of money will reach the card.",
    "money was on its way back to my card",
    featured.revision_one_id,
  ),
  corrected: finding(
    "JF-PREVIEW-TKT104-R2",
    "LABEL_SUPPORTED",
    "The text says the refund was approved and asks where it is, which matches a question about refund arrival.",
    "refund you approved on Tuesday",
    featured.revision_two_id,
  ),
  ambiguous: finding(
    "JF-PREVIEW-TKT427",
    "INSUFFICIENT",
    "The text does not establish whether a refund was approved or is being requested for the first time.",
    "",
    featured.revision_one_id,
  ),
};

function makeRelease(revisionNumber: 1 | 2): Release {
  const revisionId = revisionNumber === 1 ? featured.revision_one_id : featured.revision_two_id;
  const sourceRows = revisionNumber === 1 ? rowsOne : rowsTwo;
  const contentDigest = revisionNumber === 1 ? "preview-digest-revision-1" : "preview-digest-revision-2";
  const selectedFindings: Record<string, Finding> = revisionNumber === 1
    ? { "TKT-104": findings.wrong, "TKT-205": findings.broken, "TKT-318": findings.paraphrase }
    : { "TKT-104": findings.corrected, "TKT-205": findings.broken, "TKT-318": findings.paraphrase };
  const judgments: Record<string, Judgment> = {};
  for (const rowId of sampleIds) {
    const row = sourceRows.find((item) => item.rowId === rowId)!;
    const reused = revisionNumber === 2 && rowId !== "TKT-104";
    judgments[rowId] = bind(revisionId, row, selectedFindings[rowId], contentDigest, reused);
  }
  const row104 = sourceRows.find((row) => row.rowId === "TKT-104")!;
  const row205 = sourceRows.find((row) => row.rowId === "TKT-205")!;
  const refundStatus = rubric.clauses.find((clause) => clause.id === "REFUND_STATUS")!;
  const newRequest = rubric.clauses.find((clause) => clause.id === "NEW_REFUND_REQUEST")!;
  const challenges = revisionNumber === 1
    ? [
        challenge("CH-PREVIEW-104", revisionId, row104, refundStatus, "UPHELD", findings.wrong.finding_id),
        challenge("CH-PREVIEW-205", revisionId, row205, newRequest, "REJECTED", findings.broken.finding_id),
      ]
    : [];
  const isAccepted = revisionNumber === 2;
  return {
    revision_id: revisionId,
    dataset_id: dataset.dataset_id,
    revision_number: revisionNumber,
    parent_revision_id: revisionNumber === 1 ? "" : featured.revision_one_id,
    publisher: "Synthetic publisher",
    buyer: "Synthetic buyer",
    reviewer: "Synthetic reviewer",
    rows: sourceRows,
    sample_ids: sampleIds,
    rubric,
    rubric_hash: "synthetic-preview-rubric-hash",
    threshold: dataset.threshold,
    content_digest: contentDigest,
    sample_digest: "synthetic-preview-sample-hash",
    published_at: at,
    challenge_cutoff: at + featured.challenge_window_seconds,
    terms_approved: true,
    terms_receipt: { approval_id: "PREVIEW-TERMS-APPROVAL", status: "SIMULATED" },
    status: revisionNumber === 1 ? "FAILED" : isAccepted ? "ACCEPTED" : "REVIEWING",
    sample_result: {
      sampled_rows: 3,
      adjudicated_rows: 3,
      supported_rows: revisionNumber === 1 ? 2 : 3,
      unsupported_rows: revisionNumber === 1 ? 1 : 0,
      threshold: 3,
      open_challenges: 0,
    },
    challenges,
    closed_at: 0,
    closure_reason: "",
    acceptance_receipt: isAccepted
      ? {
          receipt_id: "PREVIEW-BUYER-RECEIPT",
          revision_id: revisionId,
          buyer: "Synthetic buyer",
          accepted_at: at + featured.challenge_window_seconds + 1,
          sampled_rows: 3,
          supported_rows: 3,
          status: "ACCEPTED_BY_BUYER",
        }
      : {},
    judgments,
    example_judgment: bind(
      revisionId,
      sourceRows.find((row) => row.rowId === "TKT-427")!,
      findings.ambiguous,
      contentDigest,
    ),
  };
}

export function getSyntheticScenario(): Scenario {
  return {
    source: "synthetic-preview",
    sourceNote: "Synthetic demonstration state — these preview findings and receipts are not on chain.",
    revisionOne: makeRelease(1),
    revisionTwo: makeRelease(2),
    changedRowId: "TKT-104",
    failedAcceptanceAttempt: {
      status: "FAILED",
      reason: "SAMPLE_CONTAINS_INCORRECT_OR_INSUFFICIENT_FINDING",
    },
  };
}

export function getClause(release: Release, clauseId: string): RubricClause | undefined {
  return release.rubric.clauses.find((clause) => clause.id === clauseId);
}

export function releaseRows(release: Release): TicketRow[] {
  return release.sample_ids
    .map((rowId) => release.rows.find((row) => row.rowId === rowId))
    .filter((row): row is TicketRow => Boolean(row));
}

export function formatChainDate(value: number): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value * 1000)) + " UTC";
}
