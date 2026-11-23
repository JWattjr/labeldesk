"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileDiff,
  Fingerprint,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageSquareWarning,
  RefreshCw,
  ShieldCheck,
  TicketCheck,
  X,
} from "lucide-react";
import dataset from "@/data/refund-tickets.json";
import rubricDocument from "@/data/refund-rubric.json";
import proof from "@/deploy/proof.json";
import {
  formatChainDate,
  getClause,
  getSyntheticScenario,
  releaseRows,
  type Challenge,
  type Release,
  type Scenario,
  type TicketRow,
  type Judgment,
} from "@/lib/domain";
import {
  contractAddress,
  connectWallet,
  estimateTransactionFees,
  getVerifiedScenarioSnapshot,
  loadScenario,
  readRelease,
  rowArgs,
  STUDIO_EXPLORER,
  waitForTransaction,
  type TransactionProgress,
  type WalletSession,
} from "@/lib/chain";

type View = "workbench" | "compare";

type FrontendEvidence = {
  frontend_run?: {
    ambiguity?: {
      revision_id: string;
      ticket_text: string;
      judgment: Judgment;
      explorer_url: string;
      validator_votes?: Record<string, string>;
    };
  };
};

const recordedAmbiguity = (proof as FrontendEvidence).frontend_run?.ambiguity;
const ambiguityVotes = Object.values(recordedAmbiguity?.validator_votes ?? {});

const decisionLabel: Record<string, string> = {
  LABEL_SUPPORTED: "Supported",
  LABEL_INCORRECT: "Label incorrect",
  INSUFFICIENT: "Insufficient evidence",
};

const statusLabel: Record<string, string> = {
  AWAITING_BUYER_APPROVAL: "Awaiting buyer terms",
  REVIEWING: "In review",
  ELIGIBLE: "Eligible for buyer acceptance",
  FAILED: "Failed",
  ACCEPTED: "Accepted by buyer",
};

function shortAddress(value: string) {
  if (!value.startsWith("0x") || value.length < 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function roleMatch(account: string, role: string) {
  return Boolean(account && role && account.toLowerCase() === role.toLowerCase());
}

function releaseStatusClass(status: string) {
  if (status === "FAILED") return "status status--failed";
  if (status === "ACCEPTED") return "status status--accepted";
  if (status === "ELIGIBLE") return "status status--eligible";
  if (status === "AWAITING_BUYER_APPROVAL") return "status status--waiting";
  return "status status--reviewing";
}

function transactionStatusLabel(status: string) {
  if (status === "SUBMISSION_FAILED") return "Not submitted";
  if (status === "NO_CONSENSUS") return "No consensus";
  if (status === "FINALIZED_ERROR") return "Finalized error";
  if (status === "FINALIZED_SUCCESS") return "Finalized successfully";
  if (status === "ACCEPTED") return "Accepted · awaiting finality";
  if (status === "PENDING") return "Pending consensus";
  return "Submitted";
}

function findingFor(release: Release, rowId: string) {
  return release.judgments?.[rowId]?.finding;
}

function exactRow(release: Release, rowId: string) {
  return release.rows.find((row) => row.rowId === rowId);
}

function sampleSentence(release: Release) {
  return `${release.sample_result.supported_rows} of ${release.sample_result.sampled_rows} sampled rows supported`;
}

export default function LabelDeskClient({ view }: { view: View }) {
  const [scenario, setScenario] = useState<Scenario>(() => view === "compare" ? getVerifiedScenarioSnapshot() : getSyntheticScenario());
  const [scenarioReady, setScenarioReady] = useState(() => view === "compare");
  const [selectedRowId, setSelectedRowId] = useState("TKT-104");
  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [transaction, setTransaction] = useState<TransactionProgress | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeClause, setChallengeClause] = useState("REFUND_STATUS");
  const [releasePrefix, setReleasePrefix] = useState("");
  const [workingRelease, setWorkingRelease] = useState<Release | null>(null);
  const [now, setNow] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishRevision, setPublishRevision] = useState<1 | 2>(1);
  const [buyerAddress, setBuyerAddress] = useState("");
  const [reviewerAddress, setReviewerAddress] = useState("");
  const [challengeWindow, setChallengeWindow] = useState(600);
  const submittedHash = useRef("");
  const activeActionLabel = useRef("");

  const address = contractAddress();
  const live = scenario.source === "live-contract";
  const activeRelease = view === "workbench" ? workingRelease ?? scenario.revisionOne : scenario.revisionTwo;
  const selectedRow = exactRow(activeRelease, selectedRowId) ?? releaseRows(activeRelease)[0];
  const selectedFinding = findingFor(activeRelease, selectedRow.rowId);
  const selectedChallenge = activeRelease.challenges.find((item) => item.row_id === selectedRow.rowId);

  const cutoffPassed = now > activeRelease.challenge_cutoff;
  const canReview = wallet ? roleMatch(wallet.account, activeRelease.reviewer) : false;
  const canBuyer = wallet ? roleMatch(wallet.account, activeRelease.buyer) : false;
  const clauseForSelected = getClause(activeRelease, selectedRow.proposedLabel);
  const otherClause = getClause(activeRelease, selectedRow.proposedLabel === "REFUND_STATUS" ? "NEW_REFUND_REQUEST" : "REFUND_STATUS");
  const changedRow = useMemo(() => {
    const before = exactRow(scenario.revisionOne, scenario.changedRowId);
    const after = exactRow(scenario.revisionTwo, scenario.changedRowId);
    if (!before || !after) return null;
    return { before, after };
  }, [scenario]);

  useEffect(() => {
    if (view === "compare") {
      setScenario(getVerifiedScenarioSnapshot());
      setScenarioReady(true);
      return;
    }
    let current = true;
    loadScenario().then((next) => {
      if (current) setScenario(next);
    }).finally(() => {
      if (current) setScenarioReady(true);
    });
    return () => { current = false; };
  }, [view]);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function openRelease(revisionId: string) {
    setWalletError("");
    try {
      setWorkingRelease(await readRelease(revisionId));
      setSelectedRowId("TKT-104");
    } catch (error) {
      setWalletError((error as Error).message);
    }
  }

  async function connect() {
    setWalletBusy(true);
    setWalletError("");
    try {
      const session = await connectWallet((hash) => {
        submittedHash.current = hash;
        setTransaction({ hash, label: activeActionLabel.current || "Wallet transaction", status: "SUBMITTED", message: "Submitted to StudioNet. No finding is recorded yet." });
      });
      setWallet(session);
      setBuyerAddress((value) => value || session.account);
      setReviewerAddress((value) => value || session.account);
    } catch (error) {
      setWalletError((error as Error).message);
    } finally {
      setWalletBusy(false);
    }
  }

  async function sendAction(label: string, method: string, args: unknown[]) {
    if (!wallet || !address) return;
    setActionBusy(true);
    setWalletError("");
    submittedHash.current = "";
    activeActionLabel.current = label;
    try {
      const fees = await estimateTransactionFees(wallet);
      const hash = await wallet.client.writeContract({
        address: address as `0x${string}`,
        functionName: method,
        args: args as never[],
        value: 0n,
        fees,
      });
      const nextHash = String(hash);
      submittedHash.current = nextHash;
      const status = await waitForTransaction(wallet, nextHash, label, setTransaction);
      if (status === "FINALIZED_SUCCESS") {
        const revisionId = method === "publish_release" ? String(args[0]) : workingRelease?.revision_id;
        if (revisionId) {
          try {
            setWorkingRelease(await readRelease(revisionId));
          } catch {
            setWalletError("The transaction finalized. Open the frozen revision to refresh its state.");
          }
        } else {
          setScenario(await loadScenario());
        }
      }
    } catch (error) {
      const detail = (error as Error).message;
      setWalletError(detail);
      setTransaction({
        hash: submittedHash.current,
        label,
        status: submittedHash.current ? "PENDING" : "SUBMISSION_FAILED",
        message: submittedHash.current
          ? `A transaction hash was returned, but its consensus status could not be confirmed. No judgment is recorded yet. ${detail}`
          : `The wallet submission or fee quote failed before a transaction hash was returned. No contract judgment was recorded. ${detail}`,
      });
    } finally {
      activeActionLabel.current = "";
      setActionBusy(false);
    }
  }

  async function publishSelected() {
    if (!wallet || !address || !buyerAddress || !reviewerAddress) return;
    const prefix = releasePrefix.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/.test(prefix)) return;
    const revisionId = prefix + "-R" + publishRevision;
    const rows = publishRevision === 1 ? dataset.revision_one : dataset.revision_two;
    const parent = publishRevision === 1 ? "" : prefix + "-R1";
    await sendAction(`Publish revision ${publishRevision}`, "publish_release", [
      revisionId,
      prefix,
      publishRevision,
      parent,
      rowArgs(rows as TicketRow[]),
      JSON.stringify(dataset.sample_row_ids),
      JSON.stringify(rubricDocument),
      dataset.threshold,
      buyerAddress,
      reviewerAddress,
      challengeWindow,
    ]);
    setPublishOpen(false);
  }

  async function submitChallenge() {
    const challengeId = activeRelease.revision_id + "-" + selectedRow.rowId;
    await sendAction("Submit row challenge", "submit_challenge", [
      challengeId,
      activeRelease.revision_id,
      selectedRow.rowId,
      challengeClause,
    ]);
    setChallengeOpen(false);
  }

  const connectButton = address ? (
    wallet ? (
      <div className="wallet-connected" aria-label={`Connected account ${wallet.account}`}>
        <span className="wallet-dot" />
        <span>{shortAddress(wallet.account)}</span>
        <span className="wallet-network">StudioNet</span>
      </div>
    ) : (
      <button className="button button--navy button--small" onClick={connect} disabled={walletBusy}>
        {walletBusy ? <LoaderCircle className="spin" size={15} /> : <LockKeyhole size={15} />}
        <span>Connect wallet</span>
      </button>
    )
  ) : (
    <span className="wallet-unavailable">Comparison is public</span>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="LabelDesk home">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /><i /></span>
          <span className="brand-name">LabelDesk</span>
          <span className="brand-divider" />
          <span className="brand-section">Release review</span>
        </Link>
        <nav className="top-nav" aria-label="Main navigation">
          <Link className={view === "workbench" ? "top-nav-link top-nav-link--active" : "top-nav-link"} href="/">Review</Link>
          <Link className={view === "compare" ? "top-nav-link top-nav-link--active" : "top-nav-link"} href="/compare">Compare releases</Link>
          <a className="top-nav-link" href="#evidence">Evidence</a>
        </nav>
        <div className="topbar-end">
          {connectButton}
          <span className="network-chip"><span className="network-dot" />{scenario.verifiedSnapshot ? "VERIFIED · STUDIONET" : live || workingRelease ? "LIVE · STUDIONET" : "SYNTHETIC"}</span>
        </div>
      </header>

      <main className={view === "compare" ? "page page--compare" : "page page--workbench"}>
        <div className="page-heading">
          <div>
            <p className="route-label">CUSTOMER SUPPORT · REFUND INTENT</p>
            <h1>{view === "compare" ? "Compare releases" : "Refund label review"}</h1>
            <p className="heading-subtitle">
              {view === "compare"
                ? "One proposed label changed. The sample and the rule stayed fixed."
                : "Inspect the frozen sample, its label findings, and the review cutoff."}
            </p>
          </div>
          <div className="heading-actions">
            {view === "workbench" ? (
              <Link className="button button--red" href="/compare">
                <ArrowLeftRight size={16} />
                <span>Compare releases</span>
                <ArrowRight size={14} />
              </Link>
            ) : (
              <Link className="button button--line" href="/">
                <ArrowRight className="flip" size={15} />
                <span>Back to review</span>
              </Link>
            )}
          </div>
        </div>

        <div className={`source-strip source-strip--${scenario.source}`} role="status">
          <span className="source-mark" aria-hidden="true">{scenario.source === "live-contract" ? <Check size={13} /> : <span />}</span>
          <span className="source-title">{workingRelease || scenario.source === "live-contract" ? "Contract state" : "Synthetic demonstration"}</span>
          <span>{workingRelease ? "Finalized StudioNet release state. The ticket text and rubric are synthetic." : scenario.sourceNote}</span>
          {!scenarioReady && <span className="source-loading"><LoaderCircle className="spin" size={13} /> Checking release state</span>}
        </div>

        {walletError && <div className="notice notice--error" role="alert"><X size={15} />{walletError}</div>}

        {view === "compare" ? (
          <CompareView
            scenario={scenario}
            changedRow={changedRow}
            transaction={transaction}
            wallet={wallet}
            canBuyer={roleMatch(wallet?.account ?? "", scenario.revisionTwo.buyer)}
            actionBusy={actionBusy}
            onAccept={() => sendAction("Accept revision 2", "accept_release", [scenario.revisionTwo.revision_id])}
            onApprove={(release) => sendAction("Approve frozen terms", "approve_terms", [release.revision_id, release.content_digest, release.sample_digest, release.rubric_hash])}
            explorerRoot={STUDIO_EXPLORER}
          />
        ) : (
          <WorkbenchView
            scenario={scenario}
            release={activeRelease}
            selectedRow={selectedRow}
            selectedFinding={selectedFinding}
            clauseForSelected={clauseForSelected}
            otherClause={otherClause}
            selectedChallenge={selectedChallenge}
            canReview={canReview}
            canBuyer={canBuyer}
            cutoffPassed={cutoffPassed}
            walletPresent={Boolean(wallet)}
            addressPresent={Boolean(address)}
            transaction={transaction}
            actionBusy={actionBusy}
            challengeOpen={challengeOpen}
            challengeClause={challengeClause}
            onSelectRow={(rowId) => { setSelectedRowId(rowId); setChallengeOpen(false); }}
            onAccept={() => sendAction("Accept release", "accept_release", [activeRelease.revision_id])}
            onReview={() => sendAction("Review sampled row", "review_row", [activeRelease.revision_id, selectedRow.rowId])}
            onOpenChallenge={() => setChallengeOpen(true)}
            onChallengeClause={setChallengeClause}
            onSubmitChallenge={submitChallenge}
            onCancelChallenge={() => setChallengeOpen(false)}
            onAdjudicateChallenge={(challenge) => sendAction("Adjudicate challenge", "adjudicate_challenge", [challenge.challenge_id])}
            onCloseReview={() => sendAction("Close expired review", "close_expired_review", [activeRelease.revision_id])}
            onApprove={(release) => sendAction("Approve frozen terms", "approve_terms", [release.revision_id, release.content_digest, release.sample_digest, release.rubric_hash])}
          />
        )}

        {view === "workbench" && address && wallet && (
          <section className="publish-section" aria-labelledby="publish-heading">
            <div className="publish-intro">
              <div className="section-icon"><FileCheck2 size={18} /></div>
              <div>
                <h2 id="publish-heading">Publisher actions</h2>
                <p>Publish the fixed synthetic example, then have the named buyer approve its frozen terms.</p>
              </div>
              <button className="button button--line button--small" onClick={() => setPublishOpen((open) => !open)}>
                <span>{publishOpen ? "Close form" : "Publish or open a revision"}</span>
                <ChevronDown className={publishOpen ? "chevron-up" : ""} size={14} />
              </button>
            </div>
            {publishOpen && (
              <div className="publish-form">
                <label className="field">
                  <span>Release series ID</span>
                  <input value={releasePrefix} onChange={(event) => setReleasePrefix(event.target.value)} maxLength={36} spellCheck={false} />
                </label>
                <label className="field">
                  <span>Revision</span>
                  <select value={publishRevision} onChange={(event) => setPublishRevision(Number(event.target.value) as 1 | 2)}>
                    <option value={1}>Revision 1 · original proposed label</option>
                    <option value={2}>Revision 2 · corrected proposed label</option>
                  </select>
                </label>
                <label className="field">
                  <span>Named buyer address</span>
                  <input value={buyerAddress} onChange={(event) => setBuyerAddress(event.target.value)} placeholder="0x…" spellCheck={false} />
                </label>
                <label className="field">
                  <span>Named reviewer address</span>
                  <input value={reviewerAddress} onChange={(event) => setReviewerAddress(event.target.value)} placeholder="0x…" spellCheck={false} />
                </label>
                <label className="field field--narrow">
                  <span>Challenge window · seconds</span>
                  <input type="number" min={30} max={86400} value={challengeWindow} onChange={(event) => setChallengeWindow(Number(event.target.value))} />
                </label>
                <button className="button button--red" onClick={publishSelected} disabled={actionBusy || !buyerAddress || !reviewerAddress || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/.test(releasePrefix.trim())}>
                  {actionBusy ? <LoaderCircle className="spin" size={15} /> : <TicketCheck size={15} />}
                  <span>Publish frozen revision</span>
                </button>
                <button className="button button--line" disabled={actionBusy || !releasePrefix.trim()} onClick={() => openRelease(releasePrefix.trim() + "-R" + publishRevision)}>Open frozen revision</button>
                {publishRevision === 2 && <p className="field-note">Revision 2 is accepted by the contract only after revision 1 has a finalized LABEL_INCORRECT finding on TKT-104.</p>}
              </div>
            )}
          </section>
        )}

        {view === "compare" && recordedAmbiguity && (
          <section className="publish-section ambiguity-example" aria-labelledby="ambiguity-heading">
            <h2 id="ambiguity-heading">Live ambiguity example</h2>
            <p>“{recordedAmbiguity.ticket_text}”</p>
            <p><strong>{recordedAmbiguity.judgment.finding.verdict}</strong> · {recordedAmbiguity.judgment.finding.explanation}</p>
            {ambiguityVotes.length > 0 && (
              <p>Finalized by majority agreement. {ambiguityVotes.filter((vote) => vote === "agree").length} agreed, {ambiguityVotes.filter((vote) => vote === "disagree").length} disagreed.</p>
            )}
            <p>{recordedAmbiguity.revision_id} · Separate synthetic example outside the sampled rows.</p>
            <a href={recordedAmbiguity.explorer_url} target="_blank" rel="noreferrer">StudioNet judgment transaction</a>
          </section>
        )}
        {workingRelease && (
          <section className="publish-section ambiguity-example" aria-label="Ambiguity example">
            <h2>Ambiguity example</h2>
            <p>{exactRow(workingRelease, "TKT-427")?.ticketText}</p>
            <p>Separate example outside the three sampled rows.</p>
            {workingRelease.judgments["TKT-427"] ? (
              <p><strong>{workingRelease.judgments["TKT-427"].finding.verdict}</strong> · {workingRelease.judgments["TKT-427"].finding.explanation}</p>
            ) : canReview && workingRelease.terms_approved && !workingRelease.closed_at && workingRelease.status !== "ACCEPTED" && (
              <button className="button button--line" disabled={actionBusy} onClick={() => sendAction("Review ambiguity example", "review_example", [workingRelease.revision_id, "TKT-427"])}>Review ambiguity example</button>
            )}
          </section>
        )}
        <TransactionPanel transaction={transaction} />

        <footer className="page-footer" id="evidence">
          <div className="footer-brand">LD / 01</div>
          <p><strong>Evidence note.</strong> Three sampled rows only. The remaining synthetic dataset is not certified by this review.</p>
          {address && <a className="footer-contract-link" href={`${STUDIO_EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">GenLayer Explorer Contract <ArrowRight size={11} /></a>}
          <p className="footer-date">STUDIONET · CHAIN 61999</p>
        </footer>
      </main>
    </div>
  );
}

function WorkbenchView({
  scenario,
  release,
  selectedRow,
  selectedFinding,
  clauseForSelected,
  otherClause,
  selectedChallenge,
  canReview,
  canBuyer,
  cutoffPassed,
  walletPresent,
  addressPresent,
  transaction,
  actionBusy,
  challengeOpen,
  challengeClause,
  onSelectRow,
  onReview,
  onAccept,
  onOpenChallenge,
  onChallengeClause,
  onSubmitChallenge,
  onCancelChallenge,
  onAdjudicateChallenge,
  onCloseReview,
  onApprove,
}: {
  scenario: Scenario;
  release: Release;
  selectedRow: TicketRow;
  selectedFinding: ReturnType<typeof findingFor>;
  clauseForSelected: ReturnType<typeof getClause>;
  otherClause: ReturnType<typeof getClause>;
  selectedChallenge?: Challenge;
  canReview: boolean;
  canBuyer: boolean;
  cutoffPassed: boolean;
  walletPresent: boolean;
  addressPresent: boolean;
  transaction: TransactionProgress | null;
  actionBusy: boolean;
  challengeOpen: boolean;
  challengeClause: string;
  onSelectRow: (rowId: string) => void;
  onReview: () => void;
  onAccept: () => void;
  onOpenChallenge: () => void;
  onChallengeClause: (value: string) => void;
  onSubmitChallenge: () => void;
  onCancelChallenge: () => void;
  onAdjudicateChallenge: (challenge: Challenge) => void;
  onCloseReview: () => void;
  onApprove: (release: Release) => void;
}) {
  const samples = releaseRows(release);
  const sampleRatio = `${release.sample_result.supported_rows}/${release.sample_result.sampled_rows}`;
  const clauseOptions = release.rubric.clauses.filter((clause) => clause.id !== "INSUFFICIENT");
  const secondRevision = scenario.revisionTwo;
  const changedLabel = exactRow(secondRevision, selectedRow.rowId)?.proposedLabel;
  const onchainChallengeOpen = selectedChallenge?.status === "OPEN";
  const sampleEligible = release.terms_approved
    && release.sample_result.adjudicated_rows === release.sample_result.sampled_rows
    && release.sample_result.supported_rows === release.sample_result.sampled_rows
    && release.sample_result.open_challenges === 0;
  const canFinish = cutoffPassed && !release.closed_at && release.status !== "ACCEPTED";
  const canJudge = canReview && release.terms_approved && !release.closed_at && release.status !== "ACCEPTED";

  return (
    <>
      <div className="release-bar">
        <div className="release-id-block">
          <span className="release-id-label">FROZEN RELEASE</span>
          <span className="release-id">{release.dataset_id}</span>
          <span className="release-revision">REV {release.revision_number} <span>·</span> {release.revision_id}</span>
        </div>
        <div className="release-bar-right">
          <span className={releaseStatusClass(release.status)}><span className="status-pin" />{statusLabel[release.status] ?? release.status}</span>
          <span className="cutoff-meta"><Clock3 size={14} />Challenge cutoff {formatChainDate(release.challenge_cutoff)}</span>
        </div>
      </div>

      <div className="workbench-grid">
        <aside className="sample-rail" aria-label="Frozen sample rows">
          <div className="rail-heading">
            <span>FROZEN SAMPLE</span>
            <strong>{String(samples.length).padStart(2, "0")} ROWS</strong>
          </div>
          <ol className="sample-list">
            {samples.map((row, index) => {
              const finding = findingFor(release, row.rowId);
              const active = row.rowId === selectedRow.rowId;
              return (
                <li key={row.rowId}>
                  <button className={`sample-entry ${active ? "sample-entry--active" : ""}`} onClick={() => onSelectRow(row.rowId)} aria-current={active ? "true" : undefined}>
                    <span className="sample-entry-top"><span className="row-index">{String(index + 1).padStart(2, "0")}</span><span className="row-id">{row.rowId}</span><span className={`state-mark state-mark--${finding?.verdict === "LABEL_SUPPORTED" ? "supported" : finding ? "failed" : "pending"}`} aria-hidden="true" /></span>
                    <span className="sample-entry-text">{row.ticketText}</span>
                    <span className="sample-entry-bottom"><span className="label-token">{row.proposedLabel}</span><span className="entry-decision">{finding ? decisionLabel[finding.verdict] : "Not adjudicated"}</span></span>
                    {active && <span className="entry-active-mark" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="sample-lock-note"><LockKeyhole size={13} /><span>Row membership frozen at publication</span></div>
          <div className="sample-ambiguity">
            <span className="ambiguity-mark">?</span>
            <div><strong>Separate example</strong><p>“Any news about my refund?” is insufficient without more context. It is outside this sample.</p></div>
          </div>
        </aside>

        <section className="inspector" aria-labelledby="inspector-heading">
          <div className="inspector-topline">
            <div className="inspector-title-group">
              <span className="inspector-kicker"><Fingerprint size={14} />ROW INSPECTOR</span>
              <h2 id="inspector-heading">{selectedRow.rowId}</h2>
            </div>
            <span className="coupon-code">REFUND / {String(release.revision_number).padStart(2, "0")}</span>
          </div>
          <div className="ticket-paper">
            <div className="paper-label"><span>EXACT TICKET TEXT</span><span>FROZEN</span></div>
            <blockquote>“{selectedRow.ticketText}”</blockquote>
            <div className="ticket-rule" />
            <div className="label-compare-line">
              <div><span className="data-label">PROPOSED LABEL</span><strong className="current-label">{selectedRow.proposedLabel}</strong></div>
              {changedLabel && changedLabel !== selectedRow.proposedLabel && (
                <div className="correction-field"><span className="data-label">REVISION 2</span><strong className="corrected-label"><ArrowDownRight size={14} />{changedLabel}</strong></div>
              )}
            </div>
          </div>

          <div className="rubric-block">
            <div className="rubric-heading"><span>GOVERNING RUBRIC</span><span>{release.rubric.version}</span></div>
            {clauseForSelected && (
              <div className="rubric-clause rubric-clause--active">
                <span className="clause-tag">{clauseForSelected.id}</span>
                <p>{clauseForSelected.text}</p>
              </div>
            )}
            {otherClause && selectedRow.rowId === "TKT-104" && (
              <div className="rubric-clause rubric-clause--related">
                <span className="clause-tag">{otherClause.id}</span>
                <p>{otherClause.text}</p>
              </div>
            )}
          </div>

          <div className="finding-block">
            <div className="finding-heading">
              <span><ShieldCheck size={15} />FINALIZED FINDING</span>
              {selectedFinding ? <span className={`finding-pill finding-pill--${selectedFinding.verdict === "LABEL_SUPPORTED" ? "supported" : selectedFinding.verdict === "INSUFFICIENT" ? "insufficient" : "incorrect"}`}><i />{decisionLabel[selectedFinding.verdict]}</span> : <span className="pending-pill"><i />No finalized finding</span>}
            </div>
            {selectedFinding ? (
              <>
                <p className="finding-explanation">{selectedFinding.explanation}</p>
                {selectedFinding.evidence_excerpt && <p className="evidence-quote"><span>“</span>{selectedFinding.evidence_excerpt}<span>”</span></p>}
                <div className="finding-binding"><Link2 size={12} /><span>Bound to {release.revision_id} · {selectedRow.rowId} · {selectedRow.proposedLabel}</span><span className="binding-hash">{selectedFinding.finding_id}</span></div>
              </>
            ) : (
              <p className="empty-finding">No finalized judgment is stored for this row yet. A pending or failed transaction does not count as INSUFFICIENT.</p>
            )}
            {selectedChallenge && (
              <div className={`challenge-outcome challenge-outcome--${selectedChallenge.outcome.toLowerCase()}`}>
                <MessageSquareWarning size={14} />
                <span>Challenge {selectedChallenge.outcome}</span>
                <span className="challenge-resolution">{selectedChallenge.resolution_basis === "REUSED_FINALIZED_MATCHING_FINDING" ? `Reused ${selectedChallenge.finding_id}` : selectedChallenge.resolution_basis}</span>
              </div>
            )}
            {onchainChallengeOpen && canJudge && (
              <button className="button button--navy button--small action-trigger" onClick={() => onAdjudicateChallenge(selectedChallenge!)} disabled={actionBusy}>
                {actionBusy ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}
                <span>Resolve open challenge</span>
              </button>
            )}
          </div>

          <div className="inspector-actions">
            {addressPresent && canJudge && !selectedFinding && !onchainChallengeOpen && (
              <button className="button button--navy" onClick={onReview} disabled={actionBusy}>
                {actionBusy ? <LoaderCircle className="spin" size={15} /> : <FileCheck2 size={15} />}
                <span>Review this row</span>
              </button>
            )}
            {addressPresent && canJudge && !selectedChallenge && !cutoffPassed && (
              <button className="button button--line" onClick={onOpenChallenge} disabled={actionBusy}>
                <MessageSquareWarning size={15} /><span>Challenge this label</span>
              </button>
            )}
            {!addressPresent && <p className="wallet-action-note"><LockKeyhole size={14} />Read-only preview. Connect wallet actions appear when a contract address is configured.</p>}
            {addressPresent && !walletPresent && <p className="wallet-action-note"><LockKeyhole size={14} />Connect a StudioNet wallet to review or challenge a row.</p>}
            {addressPresent && walletPresent && !canReview && !canBuyer && <p className="wallet-action-note"><LockKeyhole size={14} />This account is not the named reviewer or buyer for this revision.</p>}
          </div>

          {challengeOpen && (
            <div className="inline-form" role="region" aria-label="Challenge this proposed label">
              <div className="inline-form-heading"><strong>File a row challenge</strong><button aria-label="Cancel challenge" onClick={onCancelChallenge}><X size={15} /></button></div>
              <p>Challenge {selectedRow.rowId} under one clause frozen with this revision.</p>
              <label className="field"><span>Governing clause</span>
                <select value={challengeClause} onChange={(event) => onChallengeClause(event.target.value)}>
                  {clauseOptions.map((clause) => <option key={clause.id} value={clause.id}>{clause.id} · {clause.text}</option>)}
                </select>
              </label>
              <div className="inline-form-actions">
                <button className="button button--red button--small" onClick={onSubmitChallenge} disabled={actionBusy}>
                  {actionBusy ? <LoaderCircle className="spin" size={14} /> : <MessageSquareWarning size={14} />}
                  <span>Submit challenge</span>
                </button>
                <button className="text-button" onClick={onCancelChallenge}>Cancel</button>
              </div>
              <p className="field-note">If this exact row, label, and rubric were already finalized, the challenge will link to that finding instead of running the model again.</p>
            </div>
          )}
        </section>

        <aside className="release-summary">
          <div className="summary-heading"><div><span>BUYER GATE</span><h2>Sample result</h2></div><span className="summary-stamp">3 / 3</span></div>
          <div className="sample-score"><strong>{sampleRatio}</strong><span>sampled rows supported</span></div>
          <div className="score-ruler" aria-label={`${release.sample_result.supported_rows} of ${release.sample_result.sampled_rows} sampled rows supported`}>
            {samples.map((row, index) => {
              const finding = findingFor(release, row.rowId);
              return <span key={row.rowId} className={`score-segment score-segment--${finding?.verdict === "LABEL_SUPPORTED" ? "supported" : finding ? "failed" : "pending"}`} title={`${row.rowId}: ${finding ? decisionLabel[finding.verdict] : "Not adjudicated"}`} />;
            })}
          </div>
          <p className="score-caption">Threshold is {release.threshold} of {release.sample_result.sampled_rows}. This is a sample result, not a full dataset certification.</p>

          <div className="summary-details">
            <div><span>Adjudicated</span><strong>{release.sample_result.adjudicated_rows} / {release.sample_result.sampled_rows}</strong></div>
            <div><span>Open challenges</span><strong>{release.sample_result.open_challenges}</strong></div>
            <div><span>Cutoff</span><strong>{cutoffPassed ? "Passed" : "Still open"}</strong></div>
            <div><span>Buyer terms</span><strong>{release.terms_approved ? "Approved" : "Awaiting"}</strong></div>
          </div>

          {addressPresent && canBuyer && !release.terms_approved && !cutoffPassed && (
            <button className="button button--navy button--wide" onClick={() => onApprove(release)} disabled={actionBusy}>
              {actionBusy ? <LoaderCircle className="spin" size={14} /> : <CheckCheck size={14} />}
              <span>Approve frozen terms</span>
            </button>
          )}
          {addressPresent && canReview && canFinish && !sampleEligible && (
            <button className="button button--line button--wide" onClick={onCloseReview} disabled={actionBusy}>
              {actionBusy ? <LoaderCircle className="spin" size={14} /> : <Clock3 size={14} />}
              <span>Close expired review</span>
            </button>
          )}
          {release.status === "FAILED" && <div className="gate-outcome gate-outcome--failed"><X size={15} /><span>Release failed. The incorrect or unresolved sample finding stays in the denominator.</span></div>}
          {release.status === "ELIGIBLE" && <div className="gate-outcome gate-outcome--eligible"><Check size={15} /><span>Eligible for buyer acceptance. Only the named buyer can record acceptance.</span></div>}
          {canBuyer && canFinish && sampleEligible && (
              <button className="button button--red button--wide" disabled={actionBusy} onClick={onAccept}>Accept release</button>
            )}
          {release.status === "ACCEPTED" && <div className="gate-outcome gate-outcome--accepted"><CheckCheck size={15} /><span>Accepted by the named buyer. Receipt {release.acceptance_receipt.receipt_id}.</span></div>}

          <div className="release-compare-mini">
            <div className="mini-release"><span>REVISION 1</span><strong className="mini-failed">{scenario.revisionOne.sample_result.supported_rows} of 3 supported</strong><small>Failed</small></div>
            <div className="mini-release"><span>REVISION 2</span><strong className="mini-accepted">{scenario.revisionTwo.sample_result.supported_rows} of 3 supported</strong><small>Accepted in preview</small></div>
            <Link href="/compare" className="mini-compare-link"><FileDiff size={13} /><span>Compare and inspect receipt</span><ArrowRight size={13} /></Link>
          </div>
        </aside>
      </div>

      <div className="rubric-footer-strip"><span className="rubric-footer-mark">R/1</span><span>Frozen rubric</span><span className="rubric-footer-text">A refund already approved or issued is a status question. The word “refund” alone does not establish approval.</span><span className="rubric-footer-hash">{release.rubric_hash.slice(0, 18)}…</span></div>
    </>
  );
}

function CompareView({
  scenario,
  changedRow,
  transaction,
  wallet,
  canBuyer,
  actionBusy,
  onAccept,
  onApprove,
  explorerRoot,
}: {
  scenario: Scenario;
  changedRow: { before: TicketRow; after: TicketRow } | null;
  transaction: TransactionProgress | null;
  wallet: WalletSession | null;
  canBuyer: boolean;
  actionBusy: boolean;
  onAccept: () => void;
  onApprove: (release: Release) => void;
  explorerRoot: string;
}) {
  const first = scenario.revisionOne;
  const second = scenario.revisionTwo;
  const receipt = second.acceptance_receipt as Release["acceptance_receipt"] & { receipt_id?: string; accepted_at?: number; transaction_hash?: string };
  const failRow = first.rows.find((row) => row.rowId === scenario.changedRowId)!;
  const secondRow = second.rows.find((row) => row.rowId === scenario.changedRowId)!;
  const statusClause = getClause(second, "REFUND_STATUS")!;
  const newRequestClause = getClause(first, "NEW_REFUND_REQUEST")!;
  const deadlinePassed = Math.floor(Date.now() / 1000) > second.challenge_cutoff;
  const liveAcceptanceTx = typeof receipt?.transaction_hash === "string" ? receipt.transaction_hash : "";
  const liveVerdict = (release: Release, rowId: string) => {
    const outcomes = release.revision_number === 1
      ? scenario.verifiedSnapshot?.revisionOneVerdicts
      : scenario.verifiedSnapshot?.revisionTwoVerdicts;
    return outcomes?.[rowId] ?? findingFor(release, rowId)?.verdict;
  };

  return (
    <>
      <section className="compare-ledger" aria-labelledby="diff-heading">
        <div className="compare-ledger-head">
          <div>
            <p className="section-kicker"><FileDiff size={14} />FIELD-LEVEL CHANGE</p>
            <h2 id="diff-heading">One label changed</h2>
          </div>
          <div className="diff-count"><span>1</span> field changed <span className="diff-count-rule" /> all other frozen fields match</div>
        </div>
        <div className="diff-table" role="table" aria-label="Revision field comparison">
          <div className="diff-row diff-row--header" role="row"><span>ROW / FIELD</span><span>REVISION 1</span><span>REVISION 2</span><span>RESULT</span></div>
          <div className="diff-row diff-row--body" role="row">
            <div className="diff-field"><span className="diff-row-id">{scenario.changedRowId}</span><strong>proposedLabel</strong></div>
            <div className="diff-value diff-value--old"><span>{changedRow?.before.proposedLabel}</span><X size={13} /></div>
            <div className="diff-value diff-value--new"><span>{changedRow?.after.proposedLabel}</span><Check size={13} /></div>
            <div className="diff-result"><ArrowLeftRight size={14} /><span>Corrected</span></div>
          </div>
        </div>
        <div className="same-fields-line"><span className="same-pin" />Same ticket text, row IDs, sample membership, rubric, and threshold <span className="same-arrow">→</span> content digests are revision-bound.</div>
      </section>

      <section className="comparison-body" aria-label="Release evidence and acceptance results">
        <div className="compare-evidence">
          <div className="ticket-evidence-head"><span className="ticket-serial">SAMPLE ROW · {scenario.changedRowId}</span><span className="ticket-mini-serial">{scenario.changedRowId} / REFUND</span></div>
          <blockquote className="compare-ticket-text">“{failRow.ticketText}”</blockquote>
          <div className="ticket-coupon-rule"><span /><span /><span /><span /><span /><span /></div>
          <div className="compare-clause-grid">
            <div className="compare-clause compare-clause--old"><div className="clause-head"><span>R1 PROPOSED CLAUSE</span><span className="clause-tag clause-tag--red">{newRequestClause.id}</span></div><p>{newRequestClause.text}</p></div>
            <div className="compare-clause compare-clause--new"><div className="clause-head"><span>R2 GOVERNING CLAUSE</span><span className="clause-tag clause-tag--purple">{statusClause.id}</span></div><p>{statusClause.text}</p></div>
          </div>
          <div className="paraphrase-note"><span className="paraphrase-mark">↳</span><p>Meaning, not one keyword, controls the label. “You said the money was on its way back to my card. When should I see it?” is also refund status.</p><span className="paraphrase-id">TKT-318</span></div>
        </div>

        <div className="release-results">
          <div className="results-heading"><div><span className="section-kicker"><ClipboardCheck size={14} />SAMPLE RESULT</span><h2>Release outcomes</h2></div><span className="result-denom">3 ROWS / 3 REQUIRED</span></div>
          <div className="result-release result-release--failed">
            <div className="result-release-title"><span className="release-num">01</span><div><strong>Revision 1</strong><small>{first.revision_id}</small></div><span className={releaseStatusClass(first.status)}>{statusLabel[first.status]}</span></div>
            <div className="result-ratio"><strong>{sampleSentence(first)}</strong><span>Threshold not met</span></div>
            <div className="result-bars" aria-label={sampleSentence(first)}>{first.sample_ids.map((rowId) => <span key={rowId} className={`result-bar ${liveVerdict(first, rowId) === "LABEL_SUPPORTED" ? "result-bar--supported" : "result-bar--failed"}`} title={`${rowId}: ${liveVerdict(first, rowId) ?? "Not adjudicated"}`} />)}</div>
            <p className="result-detail"><X size={13} />{scenario.changedRowId}: proposed label is incorrect. This revision remains failed.</p>
            {scenario.verifiedSnapshot && <p className="result-binding">Revision-bound content digest · {first.content_digest.slice(0, 18)}…</p>}
          </div>
          <div className="result-release result-release--accepted">
            <div className="result-release-title"><span className="release-num">02</span><div><strong>Revision 2</strong><small>{second.revision_id}</small></div><span className={releaseStatusClass(second.status)}>{statusLabel[second.status]}</span></div>
            <div className="result-ratio"><strong>{sampleSentence(second)}</strong><span>All sampled rows supported</span></div>
            <div className="result-bars" aria-label={sampleSentence(second)}>{second.sample_ids.map((rowId) => <span key={rowId} className={`result-bar ${liveVerdict(second, rowId) === "LABEL_SUPPORTED" ? "result-bar--supported" : "result-bar--failed"}`} title={`${rowId}: ${liveVerdict(second, rowId) ?? "Not adjudicated"}`} />)}</div>
            <p className="result-detail result-detail--accepted"><Check size={13} />Buyer acceptance recorded after the cutoff.</p>
            {scenario.verifiedSnapshot && <p className="result-binding">Revision-bound content digest · {second.content_digest.slice(0, 18)}…</p>}
          </div>

          <div className="acceptance-events">
            <div className="event-row event-row--failed">
              <span className="event-symbol"><X size={13} /></span>
              <div><strong>Buyer tried to accept revision 1</strong><small>{scenario.failedAcceptanceAttempt?.reason ?? "No failing attempt receipt is recorded."}</small></div>
              {scenario.failedAcceptanceAttempt?.transactionHash ? <a href={scenario.failedAcceptanceAttempt.explorerUrl} target="_blank" rel="noreferrer">View tx <ArrowRight size={12} /></a> : <span className="event-preview">PREVIEW</span>}
            </div>
            <div className="event-row event-row--accepted">
              <span className="event-symbol"><CheckCheck size={13} /></span>
              <div><strong>Buyer accepted revision 2</strong><small>{receipt?.receipt_id ?? "No contract receipt in synthetic preview."}</small></div>
              {liveAcceptanceTx ? <a href={`${explorerRoot}/tx/${liveAcceptanceTx}`} target="_blank" rel="noreferrer">View tx <ArrowRight size={12} /></a> : <span className="event-preview">{scenario.source === "live-contract" ? "RECEIPT" : "PREVIEW"}</span>}
            </div>
          </div>

          {scenario.source === "live-contract" && canBuyer && !second.terms_approved && !deadlinePassed && (
            <button className="button button--navy button--wide" onClick={() => onApprove(second)} disabled={actionBusy}>
              {actionBusy ? <LoaderCircle className="spin" size={15} /> : <CheckCheck size={15} />}<span>Approve revision 2 terms</span>
            </button>
          )}
          {scenario.source === "live-contract" && canBuyer && second.status === "ELIGIBLE" && deadlinePassed && (
            <button className="button button--red button--wide accept-button" onClick={onAccept} disabled={actionBusy}>
              {actionBusy ? <LoaderCircle className="spin" size={15} /> : <CheckCheck size={15} />}<span>Accept revision 2</span><ArrowRight size={14} />
            </button>
          )}
        </div>
      </section>

      <section className="receipt-strip" aria-labelledby="receipt-heading">
        <div className="receipt-stamp"><CheckCheck size={23} /><span>BUYER<br />RECEIPT</span></div>
        <div className="receipt-main">
          <div className="receipt-title-line"><span className="section-kicker">ACCEPTED BY BUYER</span><span className="receipt-state"><i />{receipt?.status === "ACCEPTED_BY_BUYER" ? "FINALIZED" : "SIMULATED"}</span></div>
          <h2 id="receipt-heading">Revision 2 accepted</h2>
          <p>{sampleSentence(second)} · challenge cutoff {formatChainDate(second.challenge_cutoff)} · threshold 3 of 3.</p>
        </div>
        <dl className="receipt-fields">
          <div><dt>Receipt ID</dt><dd>{receipt?.receipt_id ?? "Preview only"}</dd></div>
          <div><dt>Accepted</dt><dd>{receipt?.accepted_at ? formatChainDate(receipt.accepted_at) : "Not on chain"}</dd></div>
          <div><dt>Revision 1 afterward</dt><dd className="receipt-failed">Still FAILED</dd></div>
        </dl>
      </section>

      <div className="sample-scope-note"><span className="scope-rivet" />This comparison covers 3 of 3 sampled rows. It does not certify the entire dataset.</div>
      {transaction && <div className="compare-tx-note"><TransactionPanel transaction={transaction} /></div>}
    </>
  );
}

function TransactionPanel({ transaction }: { transaction: TransactionProgress | null }) {
  if (!transaction) return null;
  const className = transaction.status === "SUBMISSION_FAILED" || transaction.status === "NO_CONSENSUS" || transaction.status === "FINALIZED_ERROR"
    ? "transaction-panel transaction-panel--error"
    : transaction.status === "FINALIZED_SUCCESS"
      ? "transaction-panel transaction-panel--success"
      : "transaction-panel transaction-panel--pending";
  return (
    <section className={className} aria-live="polite">
      {transaction.status === "FINALIZED_SUCCESS" ? <CheckCheck size={16} /> : transaction.status === "SUBMISSION_FAILED" || transaction.status === "NO_CONSENSUS" || transaction.status === "FINALIZED_ERROR" ? <X size={16} /> : <LoaderCircle className="spin" size={16} />}
      <div><strong>{transaction.label} · {transactionStatusLabel(transaction.status)}</strong><p>{transaction.message}</p></div>
      {transaction.hash && <a href={`${STUDIO_EXPLORER}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">Explorer <ArrowRight size={12} /></a>}
    </section>
  );
}
