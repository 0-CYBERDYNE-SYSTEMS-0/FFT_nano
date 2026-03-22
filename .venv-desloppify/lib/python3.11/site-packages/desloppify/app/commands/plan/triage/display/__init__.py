"""Dashboard/display rendering for triage workflows."""

from .dashboard import (
    cmd_triage_dashboard,
    print_organize_result,
    print_progress,
    print_reflect_dashboard,
    print_reflect_result,
    show_plan_summary,
)
from .layout import (
    print_action_guidance,
    print_dashboard_header,
    print_issues_by_dimension,
    print_prior_stage_reports,
)
from .primitives import print_stage_progress
from .progress import _print_progress

__all__ = [
    "_print_progress",
    "cmd_triage_dashboard",
    "print_action_guidance",
    "print_dashboard_header",
    "print_issues_by_dimension",
    "print_organize_result",
    "print_prior_stage_reports",
    "print_progress",
    "print_reflect_dashboard",
    "print_reflect_result",
    "print_stage_progress",
    "show_plan_summary",
]
