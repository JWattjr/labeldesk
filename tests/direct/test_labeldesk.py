import itertools
import json

import pytest

from conftest import (
    BASE_TIME,
    FIXTURE,
    RUBRIC,
    approve,
    canonical,
    mock_judgment,
    publish,
    rows,
    sample_ids,
    set_time,
)


def publish_root(labeldesk, revision_id="LABELDESK-R1", **kwargs):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"], revision_id, **kwargs)
    approve(c, vm, labeldesk["buyer"], revision_id)
    return c


def review(c, vm, reviewer, revision_id, row_id, verdict, excerpt=""):
    vm.sender = reviewer
    mock_judgment(vm, verdict, excerpt)
    return c.review_row(revision_id, row_id)


def support_sample(c, vm, reviewer, revision_id):
    review(c, vm, reviewer, revision_id, "TKT-104", "LABEL_SUPPORTED", "approved on Tuesday")
    review(c, vm, reviewer, revision_id, "TKT-205", "LABEL_SUPPORTED", "arrived broken")
    review(c, vm, reviewer, revision_id, "TKT-318", "LABEL_SUPPORTED", "money was on its way back to my card")


def failed_root(c, vm, reviewer, revision_id):
    review(c, vm, reviewer, revision_id, "TKT-104", "LABEL_INCORRECT", "approved on Tuesday")
    review(c, vm, reviewer, revision_id, "TKT-205", "LABEL_SUPPORTED", "arrived broken")
    review(c, vm, reviewer, revision_id, "TKT-318", "LABEL_SUPPORTED", "money was on its way back to my card")


def publish_corrected(c, vm, publisher, buyer, reviewer, root_id="LABELDESK-R1", revision_id="LABELDESK-R2", **kwargs):
    publish(
        c, vm, publisher, buyer, reviewer, revision_id,
        revision_number=2,
        parent_id=root_id,
        row_data=rows(2),
        **kwargs,
    )
    approve(c, vm, buyer, revision_id)
    return c


def test_publication_freezes_the_sample_and_requires_buyer_terms_approval(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"], "TERMS-R1")
    release = c.get_release("TERMS-R1")
    assert release["status"] == "AWAITING_BUYER_APPROVAL"
    assert release["sample_ids"] == sorted(sample_ids())
    assert release["sample_result"] == {
        "sampled_rows": 3,
        "adjudicated_rows": 0,
        "supported_rows": 0,
        "unsupported_rows": 0,
        "threshold": 3,
        "open_challenges": 0,
    }
    assert release["challenge_cutoff"] == BASE_TIME + 60
    vm.sender = labeldesk["reviewer"]
    with vm.expect_revert("BUYER_TERMS_NOT_APPROVED"):
        c.review_row("TERMS-R1", "TKT-104")
    vm.sender = labeldesk["publisher"]
    with vm.expect_revert("ONLY_NAMED_BUYER_MAY_APPROVE_TERMS"):
        c.approve_terms("TERMS-R1", release["content_digest"], release["sample_digest"], release["rubric_hash"])
    vm.sender = labeldesk["buyer"]
    with vm.expect_revert("CONTENT_DIGEST_MISMATCH"):
        c.approve_terms("TERMS-R1", "0" * 64, release["sample_digest"], release["rubric_hash"])
    receipt = approve(c, vm, labeldesk["buyer"], "TERMS-R1")
    assert receipt["sample_ids"] == sorted(sample_ids())
    assert receipt["threshold"] == 3
    assert c.get_release("TERMS-R1")["terms_approved"] is True


def test_publish_normalizes_abi_address_strings_before_storage(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    vm.sender = labeldesk["publisher"]
    receipt = c.publish_release(
        "ADDRESS-STRINGS-R1",
        FIXTURE["dataset_id"],
        1,
        "",
        canonical(rows(1)),
        canonical(sample_ids()),
        canonical(RUBRIC),
        3,
        str(labeldesk["buyer"]),
        str(labeldesk["reviewer"]),
        60,
    )
    assert receipt["revision_id"] == "ADDRESS-STRINGS-R1"
    assert c.release_buyers["ADDRESS-STRINGS-R1"] == labeldesk["buyer"]
    assert c.release_reviewers["ADDRESS-STRINGS-R1"] == labeldesk["reviewer"]


def test_revision_two_only_changes_the_featured_label_and_old_finding_cannot_attach_to_it(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish_root(labeldesk)
    failed_root(c, vm, labeldesk["reviewer"], "LABELDESK-R1")
    root_target = c.get_judgment("LABELDESK-R1", "TKT-104")
    assert root_target["binding"]["revision_id"] == "LABELDESK-R1"
    assert root_target["binding"]["proposed_label"] == "NEW_REFUND_REQUEST"
    assert root_target["finding"]["verdict"] == "LABEL_INCORRECT"

    # A challenge of the exact adjudicated evidence links to the finding and cannot invoke the model again.
    vm.clear_mocks()
    vm.sender = labeldesk["reviewer"]
    challenge = c.submit_challenge("R1-WRONG-LABEL", "LABELDESK-R1", "TKT-104", "REFUND_STATUS")
    assert challenge["challenge"]["outcome"] == "UPHELD"
    assert challenge["challenge"]["resolution_basis"] == "REUSED_FINALIZED_MATCHING_FINDING"
    assert challenge["challenge"]["finding_id"] == root_target["finding"]["finding_id"]
    assert challenge["reused"] is True
    assert c.get_release("LABELDESK-R1")["sample_result"]["adjudicated_rows"] == 3
    with vm.expect_revert("ONE_CHALLENGE_PER_SAMPLED_ROW_AND_REVISION"):
        c.submit_challenge("R1-DUPLICATE", "LABELDESK-R1", "TKT-104", "REFUND_STATUS")

    # A correctly labeled row's challenge is rejected and shares its exact finalized finding.
    vm.clear_mocks()
    correct_challenge = c.submit_challenge("R1-CORRECT-LABEL", "LABELDESK-R1", "TKT-205", "NEW_REFUND_REQUEST")
    assert correct_challenge["challenge"]["outcome"] == "REJECTED"
    assert correct_challenge["challenge"]["finding_id"] == c.get_judgment("LABELDESK-R1", "TKT-205")["finding"]["finding_id"]
    assert c.get_release("LABELDESK-R1")["sample_result"]["sampled_rows"] == 3

    # Changed text, membership, rubric, threshold, or a second label change cannot inherit the pass.
    bad_rows = rows(2)
    bad_rows[0]["ticketText"] = "Where is the refund you approved last Tuesday?"
    vm.sender = labeldesk["publisher"]
    with vm.expect_revert("FEATURED_CORRECTION_TICKET_MUST_REMAIN_FROZEN"):
        publish(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"], "BAD-TEXT", 2, "LABELDESK-R1", row_data=bad_rows)
    bad_sample = ["TKT-104", "TKT-427", "TKT-318"]
    with vm.expect_revert("SAMPLE_MEMBERSHIP_CHANGED_ACROSS_REVISIONS"):
        publish(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"], "BAD-SAMPLE", 2, "LABELDESK-R1", row_data=rows(2), sample=bad_sample)
    with vm.expect_revert("FEATURED_THRESHOLD_MUST_REQUIRE_ALL_SAMPLED_ROWS"):
        publish(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"], "BAD-THRESHOLD", 2, "LABELDESK-R1", row_data=rows(2), threshold=2)
    bad_rubric = json.loads(json.dumps(RUBRIC))
    bad_rubric["clauses"][0]["text"] += " Never ask a follow-up question."
    with vm.expect_revert("RUBRIC_CHANGED_ACROSS_REVISIONS"):
        publish(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"], "BAD-RUBRIC", 2, "LABELDESK-R1", row_data=rows(2), rubric=bad_rubric)
    extra_change = rows(2)
    extra_change[1]["proposedLabel"] = "REFUND_STATUS"
    with vm.expect_revert("REVISION_2_MUST_CHANGE_ONLY_THE_FEATURED_PROPOSED_LABEL"):
        publish(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"], "BAD-SECOND-LABEL", 2, "LABELDESK-R1", row_data=extra_change)

    publish_corrected(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"])
    vm.sender = labeldesk["reviewer"]
    mock_judgment(vm, "LABEL_SUPPORTED", "approved on Tuesday")
    corrected = c.review_row("LABELDESK-R2", "TKT-104")
    assert corrected["finding"]["verdict"] == "LABEL_SUPPORTED"
    assert corrected["binding"]["revision_id"] == "LABELDESK-R2"
    assert corrected["binding"]["proposed_label"] == "REFUND_STATUS"

    # The unchanged findings are reused once, with new revision-specific wrappers.
    vm.clear_mocks()
    reused = c.review_row("LABELDESK-R2", "TKT-205")
    assert reused["reused"] is True
    assert reused["binding"]["revision_id"] == "LABELDESK-R2"
    assert reused["binding"]["source_revision_id"] == "LABELDESK-R1"
    assert reused["finding"]["finding_id"] == c.get_judgment("LABELDESK-R1", "TKT-205")["finding"]["finding_id"]
    comparison = c.get_comparison("LABELDESK-R1", "LABELDESK-R2")
    assert comparison["changes"] == [{
        "row_id": "TKT-104",
        "field": "proposedLabel",
        "before": "NEW_REFUND_REQUEST",
        "after": "REFUND_STATUS",
        "ticket_text": "Where is the refund you approved on Tuesday?",
    }]
    assert comparison["common_sample_ids"] == sorted(sample_ids())
    assert comparison["rubric_identical"] is True
    assert comparison["threshold_identical"] is True


def test_unreviewed_challenge_triggers_its_first_judgment_and_blocks_acceptance(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish_root(labeldesk, window=30)
    vm.sender = labeldesk["reviewer"]
    opened = c.submit_challenge("R1-PENDING", "LABELDESK-R1", "TKT-104", "REFUND_STATUS")
    assert opened["challenge"]["status"] == "OPEN"
    assert opened["reused"] is False
    with vm.expect_revert("CHALLENGE_CUTOFF_NOT_PASSED"):
        vm.sender = labeldesk["buyer"]
        c.accept_release("LABELDESK-R1")
    set_time(vm, BASE_TIME + 31)
    vm.sender = labeldesk["buyer"]
    with vm.expect_revert("OPEN_CHALLENGE_BLOCKS_ACCEPTANCE"):
        c.accept_release("LABELDESK-R1")
    vm.sender = labeldesk["reviewer"]
    mock_judgment(vm, "LABEL_INCORRECT", "approved on Tuesday")
    result = c.adjudicate_challenge("R1-PENDING")
    assert result["reused"] is False
    assert result["challenge"]["outcome"] == "UPHELD"
    assert result["challenge"]["resolution_basis"] == "FIRST_JUDGMENT_TRIGGERED_BY_CHALLENGE"
    assert result["challenge"]["finding_id"] == result["finding"]["finding_id"]
    bound = c.get_judgment("LABELDESK-R1", "TKT-104")
    assert bound["binding"]["revision_id"] == "LABELDESK-R1"
    assert bound["finding"]["verdict"] == "LABEL_INCORRECT"


def test_acceptance_requires_cutoff_complete_supported_sample_and_named_buyer(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish_root(labeldesk, window=30)
    support_sample(c, vm, labeldesk["reviewer"], "LABELDESK-R1")
    release = c.get_release("LABELDESK-R1")
    assert release["status"] == "REVIEWING"
    assert release["sample_result"]["supported_rows"] == 3
    assert release["sample_result"]["sampled_rows"] == 3
    set_time(vm, release["challenge_cutoff"])
    vm.sender = labeldesk["buyer"]
    with vm.expect_revert("CHALLENGE_CUTOFF_NOT_PASSED"):
        c.accept_release("LABELDESK-R1")
    set_time(vm, release["challenge_cutoff"] + 1)
    vm.sender = labeldesk["publisher"]
    with vm.expect_revert("ONLY_NAMED_BUYER_MAY_ACCEPT"):
        c.accept_release("LABELDESK-R1")
    vm.sender = labeldesk["buyer"]
    receipt = c.accept_release("LABELDESK-R1")
    assert receipt["status"] == "ACCEPTED_BY_BUYER"
    assert receipt["supported_rows"] == 3
    assert receipt["sampled_rows"] == 3
    assert receipt["sample_ids"] == sorted(sample_ids())
    assert c.get_release("LABELDESK-R1")["status"] == "ACCEPTED"
    with vm.expect_revert("REVISION_ALREADY_ACCEPTED"):
        c.accept_release("LABELDESK-R1")


def test_revision_one_stays_failed_after_revision_two_is_accepted(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish_root(labeldesk, window=30)
    failed_root(c, vm, labeldesk["reviewer"], "LABELDESK-R1")
    r1 = c.get_release("LABELDESK-R1")
    assert r1["status"] == "FAILED"
    assert r1["sample_result"]["supported_rows"] == 2
    assert r1["sample_result"]["sampled_rows"] == 3
    set_time(vm, r1["challenge_cutoff"] + 1)
    vm.sender = labeldesk["buyer"]
    with vm.expect_revert("SAMPLE_CONTAINS_INCORRECT_OR_INSUFFICIENT_FINDING"):
        c.accept_release("LABELDESK-R1")
    # Revision 2 is a new publication with its own newly frozen cutoff.
    publish_corrected(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"])
    support_sample(c, vm, labeldesk["reviewer"], "LABELDESK-R2")
    r2 = c.get_release("LABELDESK-R2")
    assert r2["sample_result"]["supported_rows"] == 3
    assert r2["sample_result"]["sampled_rows"] == 3
    set_time(vm, r2["challenge_cutoff"] + 1)
    vm.sender = labeldesk["buyer"]
    receipt = c.accept_release("LABELDESK-R2")
    assert receipt["supported_rows"] == 3
    assert c.get_release("LABELDESK-R2")["status"] == "ACCEPTED"
    assert c.get_release("LABELDESK-R1")["status"] == "FAILED"
    assert c.get_acceptance_receipt("LABELDESK-R1") == {}


def test_ambiguity_example_is_agreed_insufficient_but_outside_denominator(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish_root(labeldesk, window=60)
    vm.sender = labeldesk["reviewer"]
    mock_judgment(vm, "INSUFFICIENT", "", "The text does not establish whether a refund was approved or newly requested.")
    example = c.review_example("LABELDESK-R1", "TKT-427")
    assert example["finding"]["verdict"] == "INSUFFICIENT"
    assert example["finding"]["evidence_excerpt"] == ""
    assert example["counts_toward_sample"] is False
    summary = c.get_release("LABELDESK-R1")["sample_result"]
    assert summary["sampled_rows"] == 3
    assert summary["adjudicated_rows"] == 0
    assert summary["supported_rows"] == 0


def test_unavailable_challenge_expires_without_fabricating_an_insufficient_finding(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish_root(labeldesk, window=30)
    vm.sender = labeldesk["reviewer"]
    c.submit_challenge("EXPIRED-CHALLENGE", "LABELDESK-R1", "TKT-104", "REFUND_STATUS")
    set_time(vm, BASE_TIME + 31)
    closed = c.close_expired_review("LABELDESK-R1")
    assert closed["status"] == "FAILED"
    challenge = c.get_challenge("EXPIRED-CHALLENGE")
    assert challenge["status"] == "EXPIRED"
    assert challenge["outcome"] == "UNRESOLVED"
    assert challenge["resolution_basis"] == "EXPIRED_WITHOUT_FINALIZED_JUDGMENT"
    assert challenge["finding_id"] == ""
    assert c.get_judgment("LABELDESK-R1", "TKT-104") == {}
    assert c.get_release("LABELDESK-R1")["status"] == "FAILED"


def test_closed_release_without_terms_reports_failed_and_cannot_be_accepted(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish(c, vm, labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"], "UNAPPROVED-EXPIRED-R1", window=30)
    set_time(vm, BASE_TIME + 31)
    vm.sender = labeldesk["reviewer"]
    closed = c.close_expired_review("UNAPPROVED-EXPIRED-R1")
    assert closed["status"] == "FAILED"
    assert closed["closure_reason"] == "BUYER_TERMS_NOT_APPROVED_BY_CUTOFF"
    release = c.get_release("UNAPPROVED-EXPIRED-R1")
    assert release["status"] == "FAILED"
    assert release["closed_at"] == BASE_TIME + 31
    assert release["acceptance_receipt"] == {}
    vm.sender = labeldesk["buyer"]
    with vm.expect_revert("BUYER_TERMS_NOT_APPROVED"):
        c.accept_release("UNAPPROVED-EXPIRED-R1")


def test_missing_judgment_and_stale_revision_id_never_accept(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish_root(labeldesk, window=30)
    review(c, vm, labeldesk["reviewer"], "LABELDESK-R1", "TKT-104", "LABEL_SUPPORTED", "approved on Tuesday")
    review(c, vm, labeldesk["reviewer"], "LABELDESK-R1", "TKT-205", "LABEL_SUPPORTED", "arrived broken")
    set_time(vm, BASE_TIME + 31)
    vm.sender = labeldesk["buyer"]
    with vm.expect_revert("SAMPLE_INCOMPLETE"):
        c.accept_release("LABELDESK-R1")
    with vm.expect_revert("UNKNOWN_REVISION_ID"):
        c.accept_release("LABELDESK-R1-OLD")
    vm.sender = labeldesk["reviewer"]
    result = c.close_expired_review("LABELDESK-R1")
    assert result["closure_reason"] == "SAMPLE_INCOMPLETE_AT_CUTOFF"
    assert c.get_release("LABELDESK-R1")["status"] == "FAILED"


def test_canonical_row_order_and_sample_permutations_preserve_digests(labeldesk):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    pub, buyer, reviewer = labeldesk["publisher"], labeldesk["buyer"], labeldesk["reviewer"]
    digest_pairs = set()
    source_rows = rows(1)
    source_sample = sample_ids()
    for index, permutation in enumerate(itertools.permutations(source_rows)):
        sample = list(source_sample[index % len(source_sample):] + source_sample[:index % len(source_sample)])
        revision_id = "PERM-" + str(index)
        dataset_id = "DATASET-" + str(index)
        publish(
            c, vm, pub, buyer, reviewer, revision_id,
            dataset_id=dataset_id,
            row_data=list(permutation),
            sample=sample,
        )
        release = c.get_release(revision_id)
        digest_pairs.add((release["content_digest"], release["sample_digest"]))
        assert release["rows"] == sorted(source_rows, key=lambda row: row["rowId"])
        assert release["sample_ids"] == sorted(source_sample)
    assert len(digest_pairs) == 1


@pytest.mark.parametrize("tamper", ["duplicate-row", "missing-sample", "duplicate-sample", "wrong-target-text", "stale-parent", "wrong-publisher"])
def test_publication_boundary_rejects_tampered_or_stale_revision(labeldesk, tamper):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish_root(labeldesk, window=300)
    review(c, vm, labeldesk["reviewer"], "LABELDESK-R1", "TKT-104", "LABEL_INCORRECT", "approved on Tuesday")
    changed = rows(2)
    sample = sample_ids()
    parent = "LABELDESK-R1"
    caller = labeldesk["publisher"]
    expected_error = ""
    if tamper == "duplicate-row":
        changed[-1] = dict(changed[0])
        expected_error = "DUPLICATE_OR_INVALID_ROW_ID"
    elif tamper == "missing-sample":
        changed = [row for row in changed if row["rowId"] != "TKT-205"]
        expected_error = "SAMPLE_ROW_MISSING_FROM_FROZEN_DATASET"
    elif tamper == "duplicate-sample":
        sample = ["TKT-104", "TKT-104", "TKT-318"]
        expected_error = "DUPLICATE_SAMPLE_ROW_ID"
    elif tamper == "wrong-target-text":
        changed[0]["ticketText"] = "Where is the refund you approved last Tuesday?"
        expected_error = "FEATURED_CORRECTION_TICKET_MUST_REMAIN_FROZEN"
    elif tamper == "stale-parent":
        parent = "STALE-R1"
        expected_error = "UNKNOWN_REVISION_ID"
    elif tamper == "wrong-publisher":
        caller = labeldesk["buyer"]
        expected_error = "ONLY_ORIGINAL_PUBLISHER_MAY_CREATE_REVISION_2"
    vm.sender = caller
    with vm.expect_revert(expected_error):
        publish(
            c, vm, caller, labeldesk["buyer"], labeldesk["reviewer"], "TAMPERED-R2",
            revision_number=2,
            parent_id=parent,
            row_data=changed,
            sample=sample,
        )


def test_disagreement_or_unavailable_judgment_does_not_become_insufficient(labeldesk, monkeypatch):
    c, vm = labeldesk["contract"], labeldesk["vm"]
    publish_root(labeldesk)
    import genlayer.gl as sdk

    def no_consensus(*_args, **_kwargs):
        raise sdk.vm.UserError("[NO_CONSENSUS] transaction did not finalize a judgment")

    monkeypatch.setattr(sdk.vm, "run_nondet", no_consensus)
    vm.sender = labeldesk["reviewer"]
    with vm.expect_revert("transaction did not finalize a judgment"):
        c.review_row("LABELDESK-R1", "TKT-104")
    assert c.get_judgment("LABELDESK-R1", "TKT-104") == {}
    sample_result = c.get_release("LABELDESK-R1")["sample_result"]
    assert sample_result["adjudicated_rows"] == 0
    assert sample_result["unsupported_rows"] == 0
