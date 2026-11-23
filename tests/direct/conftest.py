import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

from windows_stdin_compat import install as install_windows_stdin_compat

install_windows_stdin_compat()


ROOT = Path(__file__).resolve().parents[2]
BASE_TIME = int(datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc).timestamp())
FIXTURE = json.loads((ROOT / "data" / "refund-tickets.json").read_text(encoding="utf-8"))
RUBRIC = json.loads((ROOT / "data" / "refund-rubric.json").read_text(encoding="utf-8"))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def set_time(vm, timestamp):
    iso = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
    vm.warp(iso)
    sdk = sys.modules.get("genlayer.gl")
    if sdk is not None and getattr(sdk, "message_raw", None) is not None:
        sdk.message_raw["datetime"] = iso


def rows(revision=1):
    key = "revision_one" if revision == 1 else "revision_two"
    return [dict(row) for row in FIXTURE[key]]


def sample_ids():
    return list(FIXTURE["sample_row_ids"])


def publish(contract, vm, publisher, buyer, reviewer, revision_id, revision_number=1, parent_id="", dataset_id=None, row_data=None, sample=None, rubric=None, threshold=3, window=60):
    vm.sender = publisher
    return contract.publish_release(
        revision_id,
        dataset_id or FIXTURE["dataset_id"],
        revision_number,
        parent_id,
        canonical(rows(revision_number) if row_data is None else row_data),
        canonical(sample_ids() if sample is None else sample),
        canonical(RUBRIC if rubric is None else rubric),
        threshold,
        buyer,
        reviewer,
        window,
    )


def approve(contract, vm, buyer, revision_id):
    vm.sender = buyer
    release = contract.get_release(revision_id)
    return contract.approve_terms(
        revision_id,
        release["content_digest"],
        release["sample_digest"],
        release["rubric_hash"],
    )


def mock_judgment(vm, verdict, excerpt="", explanation="Frozen ticket text judged under the frozen refund rubric."):
    # Each direct transaction gets its own model fixture; otherwise the test
    # harness keeps the earlier broad matcher and reuses its answer for later rows.
    vm._llm_mocks.clear()
    vm._llm_mocks_hit.clear()
    vm.mock_llm(
        r".*LABELDESK_JUDGMENT_V1.*",
        json.dumps({"verdict": verdict, "explanation": explanation, "evidence_excerpt": excerpt}),
    )


@pytest.fixture
def labeldesk(direct_vm, direct_deploy, direct_owner, direct_bob, direct_charlie):
    direct_vm._chain_id = 61999
    set_time(direct_vm, BASE_TIME)
    direct_vm.sender = direct_owner
    contract = direct_deploy("contracts/labeldesk.py")
    from genlayer.py.types import Address

    publisher = Address(direct_owner)
    buyer = Address(direct_bob)
    reviewer = Address(direct_charlie)
    return {
        "contract": contract,
        "vm": direct_vm,
        "publisher": publisher,
        "buyer": buyer,
        "reviewer": reviewer,
    }
