"""Issue construction facade for the test-coverage detector."""

from __future__ import annotations

from ._issue_gaps import transitive_coverage_gap_issue, untested_module_issue
from ._issue_generation import generate_issues
from ._issue_quality import (
    quality_issue_item,
    quality_issue_rank,
    select_direct_test_quality_issue,
)

_generate_issues = generate_issues
_quality_issue_item = quality_issue_item
_quality_issue_rank = quality_issue_rank
_select_direct_test_quality_issue = select_direct_test_quality_issue
_transitive_coverage_gap_issue = transitive_coverage_gap_issue
_untested_module_issue = untested_module_issue

__all__ = [
    "_generate_issues",
    "_quality_issue_item",
    "_quality_issue_rank",
    "_select_direct_test_quality_issue",
    "_transitive_coverage_gap_issue",
    "_untested_module_issue",
]
