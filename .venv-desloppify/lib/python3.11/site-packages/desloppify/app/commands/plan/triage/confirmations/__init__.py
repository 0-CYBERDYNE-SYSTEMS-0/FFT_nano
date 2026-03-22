"""Confirmation package for triage stages.

Import concrete confirmation modules directly from this package. Avoid eager
package-level re-exports so validation helpers can depend on confirmation
primitives without loading the full confirmation tree during import.
"""

__all__: list[str] = []
