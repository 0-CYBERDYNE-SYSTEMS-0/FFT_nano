"""Primitive drawing routines for scorecard left-panel rendering."""

from __future__ import annotations

from desloppify.app.output.scorecard_parts.theme import BG, BORDER, DIM, TEXT, scale, score_color


def draw_left_panel_version(
    draw,
    *,
    center_x: int,
    baseline_y: int,
    version_text: str,
    version_bbox,
    version_width: float,
    font_version,
) -> None:
    draw.text(
        (center_x - version_width / 2, baseline_y - version_bbox[1]),
        version_text,
        fill=DIM,
        font=font_version,
    )


def draw_left_panel_title(
    draw,
    *,
    center_x: int,
    title_y: int,
    title: str,
    title_bbox,
    title_width: float,
    font_title,
) -> None:
    draw.text(
        (center_x - title_width / 2, title_y - title_bbox[1]),
        title,
        fill=TEXT,
        font=font_title,
    )


def draw_left_panel_score(
    draw,
    *,
    center_x: int,
    score_y: int,
    score_text: str,
    score_bbox,
    score_value: float,
    font_big,
) -> None:
    score_width = draw.textlength(score_text, font=font_big)
    draw.text(
        (center_x - score_width / 2, score_y - score_bbox[1]),
        score_text,
        fill=score_color(score_value),
        font=font_big,
    )


def draw_left_panel_strict(
    draw,
    *,
    center_x: int,
    strict_y: int,
    strict_value: float,
    strict_text: str,
    strict_label_bbox,
    strict_value_bbox,
    font_strict_label,
    font_strict_val,
) -> None:
    strict_label = "strict"
    label_width = draw.textlength(strict_label, font=font_strict_label)
    value_width = draw.textlength(strict_text, font=font_strict_val)
    gap = scale(5)
    strict_x = center_x - (label_width + gap + value_width) / 2
    draw.text(
        (strict_x, strict_y - strict_label_bbox[1]),
        strict_label,
        fill=DIM,
        font=font_strict_label,
    )
    draw.text(
        (strict_x + label_width + gap, strict_y - strict_value_bbox[1]),
        strict_text,
        fill=score_color(strict_value, muted=True),
        font=font_strict_val,
    )


def draw_left_panel_project_pill(
    draw,
    *,
    center_x: int,
    strict_y: int,
    strict_height: int,
    project_gap: int,
    project_pill_height: int,
    pill_pad_y: int,
    pill_pad_x: int,
    project_name: str,
    project_bbox,
    font_project,
) -> None:
    pill_top = strict_y + strict_height + project_gap
    project_y = pill_top + pill_pad_y
    project_width = draw.textlength(project_name, font=font_project)
    pill_left = center_x - project_width / 2 - pill_pad_x
    pill_right = center_x + project_width / 2 + pill_pad_x
    pill_bottom = pill_top + project_pill_height
    draw.rounded_rectangle(
        (pill_left, pill_top, pill_right, pill_bottom),
        radius=scale(3),
        fill=BG,
        outline=BORDER,
        width=1,
    )
    draw.text(
        (center_x - project_width / 2, project_y - project_bbox[1]),
        project_name,
        fill=DIM,
        font=font_project,
    )


__all__ = [
    "draw_left_panel_project_pill",
    "draw_left_panel_score",
    "draw_left_panel_strict",
    "draw_left_panel_title",
    "draw_left_panel_version",
]
