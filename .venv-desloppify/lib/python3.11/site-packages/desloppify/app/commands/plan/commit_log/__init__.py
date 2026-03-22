"""Commit-log capability entrypoints for `plan commit-log`."""

from .dispatch import cmd_commit_log_dispatch

__all__ = ["cmd_commit_log_dispatch"]
