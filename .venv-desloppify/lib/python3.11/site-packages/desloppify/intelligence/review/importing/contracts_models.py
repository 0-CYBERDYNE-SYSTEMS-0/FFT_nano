"""Dataclass-backed models for assessment import provenance and policy."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .contracts_types import AssessmentImportPolicy, AssessmentProvenanceStatus


@dataclass(frozen=True)
class AssessmentProvenanceModel:
    """Typed provenance status model for assessment import trust checks."""

    trusted: bool = False
    reason: str = ""
    import_file: str = ""
    runner: str = ""
    packet_path: str = ""
    packet_sha256: str = ""

    @classmethod
    def from_mapping(
        cls, payload: AssessmentProvenanceStatus | dict[str, Any] | None
    ) -> AssessmentProvenanceModel:
        data = payload if isinstance(payload, dict) else {}
        return cls(
            trusted=bool(data.get("trusted", False)),
            reason=str(data.get("reason", "") or ""),
            import_file=str(data.get("import_file", "") or ""),
            runner=str(data.get("runner", "") or ""),
            packet_path=str(data.get("packet_path", "") or ""),
            packet_sha256=str(data.get("packet_sha256", "") or ""),
        )

    def to_dict(self) -> AssessmentProvenanceStatus:
        payload: AssessmentProvenanceStatus = {
            "trusted": self.trusted,
            "reason": self.reason,
            "import_file": self.import_file,
        }
        if self.runner:
            payload["runner"] = self.runner
        if self.packet_path:
            payload["packet_path"] = self.packet_path
        if self.packet_sha256:
            payload["packet_sha256"] = self.packet_sha256
        return payload


@dataclass(frozen=True)
class AssessmentImportPolicyModel:
    """Typed assessment import policy model used by review import flows."""

    assessments_present: bool = False
    assessment_count: int = 0
    trusted: bool = False
    mode: str = "none"
    reason: str = ""
    provenance: AssessmentProvenanceModel = field(
        default_factory=AssessmentProvenanceModel
    )
    attest: str | None = None

    @classmethod
    def from_mapping(
        cls, payload: AssessmentImportPolicy | dict[str, Any] | None
    ) -> AssessmentImportPolicyModel:
        data = payload if isinstance(payload, dict) else {}
        attest = data.get("attest")
        return cls(
            assessments_present=bool(data.get("assessments_present", False)),
            assessment_count=int(data.get("assessment_count", 0) or 0),
            trusted=bool(data.get("trusted", False)),
            mode=str(data.get("mode", "none") or "none"),
            reason=str(data.get("reason", "") or ""),
            provenance=AssessmentProvenanceModel.from_mapping(data.get("provenance")),
            attest=(
                str(attest).strip()
                if isinstance(attest, str) and attest.strip()
                else None
            ),
        )

    def to_dict(self) -> AssessmentImportPolicy:
        payload: AssessmentImportPolicy = {
            "assessments_present": bool(self.assessments_present),
            "assessment_count": int(self.assessment_count),
            "trusted": bool(self.trusted),
            "mode": self.mode,
            "reason": self.reason,
            "provenance": self.provenance.to_dict(),
        }
        if self.attest:
            payload["attest"] = self.attest
        return payload


__all__ = ["AssessmentImportPolicyModel", "AssessmentProvenanceModel"]
