"""Cluster capability entrypoints for `plan cluster`."""

from .dispatch import cmd_cluster_dispatch

__all__ = ["cmd_cluster_dispatch"]
