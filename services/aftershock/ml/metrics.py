"""Evaluation metrics and report plots shared by all models."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.metrics import roc_auc_score

Array = NDArray[np.float64]
EPS = 1e-12


def log_loss(y: Array, p: Array) -> float:
    """Binary log loss (y in {0, 1}) or multiclass (y one-hot, p rows sum to 1)."""
    p = np.clip(p, EPS, 1 - EPS)
    if p.ndim == 1:
        return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
    return float(-np.mean(np.sum(y * np.log(p), axis=1)))


def weighted_log_loss(y: Array, p: Array, w: Array) -> float:
    p = np.clip(p, EPS, 1 - EPS)
    ll = (
        -np.sum(y * np.log(p), axis=1)
        if p.ndim == 2
        else -(y * np.log(p) + (1 - y) * np.log(1 - p))
    )
    return float(np.sum(w * ll) / np.sum(w))


def brier(y: Array, p: Array) -> float:
    if p.ndim == 1:
        return float(np.mean((p - y) ** 2))
    return float(np.mean(np.sum((p - y) ** 2, axis=1)))


def auc(y: Array, p: Array) -> float:
    return float(roc_auc_score(y, p))


def reliability(y: Array, p: Array, bins: int = 15, strategy: str = "quantile") -> dict[str, Any]:
    """Binned predicted vs observed rates, plus expected calibration error."""
    if strategy == "quantile":
        edges = np.unique(np.quantile(p, np.linspace(0, 1, bins + 1)))
    else:
        edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, len(edges) - 2)
    pred, obs, count = [], [], []
    for b in range(len(edges) - 1):
        m = idx == b
        n = int(m.sum())
        if n == 0:
            continue
        pred.append(float(p[m].mean()))
        obs.append(float(y[m].mean()))
        count.append(n)
    counts = np.array(count, dtype=float)
    ece = float(np.sum(counts * np.abs(np.array(pred) - np.array(obs))) / counts.sum())
    return {"pred": pred, "obs": obs, "count": count, "ece": ece}


def binary_report(y: Array, p: Array) -> dict[str, Any]:
    rel = reliability(y, p)
    return {
        "n": len(y),
        "base_rate": float(y.mean()),
        "log_loss": log_loss(y, p),
        "brier": brier(y, p),
        "auc": auc(y, p),
        "ece": rel["ece"],
        "reliability": rel,
    }


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


# ----------------------------------------------------------------------
# Plots. Quiet, print-like styling that matches the site: ink on paper,
# goal-line red and blue-line blue as the only strong colors.

INK = "#1b2733"
GRID = "#d5dde5"
RED = "#c8102e"
BLUE = "#0b4fa8"
MUTED = "#7a8894"


def _style_axes(ax: Any) -> None:
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(MUTED)
    ax.tick_params(colors=INK, labelsize=9)
    ax.grid(color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def reliability_plot(
    path: Path,
    curves: dict[str, dict[str, Any]],
    title: str,
    *,
    max_p: float | None = None,
) -> None:
    """Write an SVG reliability diagram with one line per named curve."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["svg.fonttype"] = "none"
    fig, ax = plt.subplots(figsize=(5.2, 4.6))
    top = max_p or max(max(c["pred"] + c["obs"]) for c in curves.values()) * 1.05
    ax.plot([0, top], [0, top], color=MUTED, linewidth=1, linestyle="--", label="Perfect")
    colors = [BLUE, RED, INK, MUTED]
    for (name, c), color in zip(curves.items(), colors, strict=False):
        ax.plot(
            c["pred"],
            c["obs"],
            marker="o",
            markersize=3.5,
            linewidth=1.6,
            color=color,
            label=f"{name} (ECE {c['ece']:.4f})",
        )
    ax.set_xlim(0, top)
    ax.set_ylim(0, top)
    ax.set_xlabel("Predicted probability", color=INK, fontsize=10)
    ax.set_ylabel("Observed frequency", color=INK, fontsize=10)
    ax.set_title(title, color=INK, fontsize=11, loc="left")
    _style_axes(ax)
    ax.legend(frameon=False, fontsize=8.5, labelcolor=INK)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, format="svg")
    plt.close(fig)


def bar_plot(
    path: Path, labels: list[str], series: dict[str, list[float]], title: str, ylabel: str
) -> None:
    """Grouped bars (for example log loss by game-time bucket per model)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["svg.fonttype"] = "none"
    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    n = len(series)
    width = 0.8 / max(n, 1)
    xs = np.arange(len(labels))
    colors = [BLUE, RED, INK, MUTED]
    for i, ((name, vals), color) in enumerate(zip(series.items(), colors, strict=False)):
        ax.bar(xs + (i - (n - 1) / 2) * width, vals, width=width, color=color, label=name)
    ax.set_xticks(xs)
    ax.set_xticklabels(labels, fontsize=8.5)
    ax.set_ylabel(ylabel, color=INK, fontsize=10)
    ax.set_title(title, color=INK, fontsize=11, loc="left")
    _style_axes(ax)
    ax.legend(frameon=False, fontsize=8.5, labelcolor=INK)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, format="svg")
    plt.close(fig)
