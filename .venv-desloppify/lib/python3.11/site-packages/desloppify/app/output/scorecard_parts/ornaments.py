"""Ornamental line primitives for the scorecard renderer."""

from __future__ import annotations

from desloppify.app.output.scorecard_parts.theme import scale


def draw_ornament(draw, cx: int, cy: int, size: int, fill) -> None:
    """Draw a small diamond ornament centered at (cx, cy)."""
    draw.polygon(
        [
            (cx, cy - size),
            (cx + size, cy),
            (cx, cy + size),
            (cx - size, cy),
        ],
        fill=fill,
    )


def draw_rule_with_ornament(
    draw,
    y: int,
    x1: int,
    x2: int,
    cx: int,
    line_fill,
    ornament_fill,
) -> None:
    """Draw a horizontal rule with a diamond ornament in the center."""
    gap = scale(8)
    draw.rectangle((x1, y, cx - gap, y + 1), fill=line_fill)
    draw.rectangle((cx + gap, y, x2, y + 1), fill=line_fill)
    draw_ornament(draw, cx, y, scale(3), ornament_fill)


def draw_vert_rule_with_ornament(
    draw,
    x: int,
    y1: int,
    y2: int,
    cy: int,
    line_fill,
    ornament_fill,
) -> None:
    """Draw a vertical rule with a diamond ornament in the center."""
    gap = scale(8)
    draw.rectangle((x, y1, x + 1, cy - gap), fill=line_fill)
    draw.rectangle((x, cy + gap, x + 1, y2), fill=line_fill)
    draw_ornament(draw, x, cy, scale(3), ornament_fill)


__all__ = [
    "draw_ornament",
    "draw_rule_with_ornament",
    "draw_vert_rule_with_ornament",
]
