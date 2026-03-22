"""Language plugin discovery and import error surfacing."""

from __future__ import annotations

import importlib
import importlib.util
import json
import logging
import os
from pathlib import Path

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.output.fallbacks import log_best_effort_failure

from . import state

logger = logging.getLogger(__name__)

# Broader than PARSE_INIT_ERRORS: plugin imports may also raise SyntaxError/TypeError.
_PLUGIN_IMPORT_ERRORS: tuple[type[Exception], ...] = (
    ImportError, SyntaxError, ValueError, TypeError, RuntimeError, OSError,
)
_PLUGIN_CONFIG_LOAD_ERRORS: tuple[type[Exception], ...] = (
    OSError,
    ValueError,
    UnicodeDecodeError,
    json.JSONDecodeError,
)


def _register_module_entrypoint(module: object) -> None:
    """Run a module-level register() entrypoint when provided."""
    register_fn = getattr(module, "register", None)
    if register_fn is None:
        return
    if not callable(register_fn):
        raise TypeError("Language module register entrypoint must be callable")
    register_fn()


def raise_load_errors() -> None:
    errors = state.get_load_errors()
    if not errors:
        return
    summaries: list[str] = []
    for module_name, ex in sorted(errors.items()):
        ex_type = type(ex).__name__
        logger.warning(
            "Language plugin %s failed to load: %s: %s",
            module_name,
            ex_type,
            ex,
        )
        summaries.append(f"{module_name}: {ex_type}: {ex}")
    raise ImportError("; ".join(summaries))


def _report_load_errors_for_load_all() -> None:
    """Emit warning diagnostics for plugin failures without aborting discovery."""
    try:
        raise_load_errors()
    except ImportError:
        # load_all historically logs plugin failures and continues so command
        # startup can proceed with the languages that did load successfully.
        return


def _user_plugins_trusted(*, load_config_fn=None) -> bool:
    """Check whether the user has opted in to loading project-local plugins.

    Returns *True* when either:
    * the environment variable ``DESLOPPIFY_TRUST_PLUGINS`` is set to ``1``, or
    * the project config key ``trust_plugins`` is truthy.
    """
    if os.environ.get("DESLOPPIFY_TRUST_PLUGINS") == "1":
        return True
    resolved_load_config = load_config_fn
    if resolved_load_config is None:
        from desloppify.base.config import load_config as resolved_load_config
    try:
        config = resolved_load_config()
        return bool(config.get("trust_plugins", False))
    except _PLUGIN_CONFIG_LOAD_ERRORS:
        return False


def reset_runtime_state() -> None:
    """Clear mutable language discovery runtime state behind one boundary."""
    state.clear()


def load_all(*, force_reload: bool = False) -> None:
    """Import all language modules to trigger registration."""
    if force_reload:
        reset_runtime_state()
    elif state.was_load_attempted() and state.all_keys():
        _report_load_errors_for_load_all()
        return

    # Mark load-attempted early to guard against re-entrancy: if a plugin
    # import transitively triggers load_all() again (e.g. via get_lang()),
    # the was_load_attempted() check above will short-circuit instead of
    # re-importing partially-initialised modules.
    state.set_load_attempted(True)

    file_dir = Path(__file__).resolve().parent
    if file_dir.name == "registry" and file_dir.parent.name == "_framework":
        lang_dir = file_dir.parent.parent
    elif file_dir.name == "_framework":
        lang_dir = file_dir.parent
    else:
        lang_dir = file_dir
    base_package = "desloppify.languages"
    failures: dict[str, BaseException] = {}

    # Discover single-file plugins by naming convention (e.g. plugin_rust.py).
    for f in sorted(lang_dir.glob("plugin_*.py")):
        module_name = f".{f.stem}"
        try:
            module = importlib.import_module(module_name, base_package)
            _register_module_entrypoint(module)
        except _PLUGIN_IMPORT_ERRORS as ex:
            logger.debug("Language plugin import failed for %s: %s", module_name, ex)
            failures[module_name] = ex

    # Discover packages (e.g. lang/typescript/)
    for d in sorted(lang_dir.iterdir()):
        if (
            d.is_dir()
            and (d / "__init__.py").exists()
            and not d.name.startswith("_")
        ):
            module_name = f".{d.name}"
            try:
                module = importlib.import_module(module_name, base_package)
                _register_module_entrypoint(module)
            except _PLUGIN_IMPORT_ERRORS as ex:
                logger.debug(
                    "Language package import failed for %s: %s", module_name, ex
                )
                failures[module_name] = ex

    # Discover user plugins from <active-project-root>/.desloppify/plugins/*.py
    # These are arbitrary code from the scan target — require explicit opt-in
    # via config key "trust_plugins": true or env DESLOPPIFY_TRUST_PLUGINS=1.
    try:
        user_plugin_dir = get_project_root() / ".desloppify" / "plugins"
        if user_plugin_dir.is_dir():
            if not _user_plugins_trusted():
                logger.warning(
                    "Skipping user plugins in %s — not trusted. "
                    "Set trust_plugins=true in .desloppify/config.json "
                    "or DESLOPPIFY_TRUST_PLUGINS=1 to allow.",
                    user_plugin_dir,
                )
            else:
                for f in sorted(user_plugin_dir.glob("*.py")):
                    spec = importlib.util.spec_from_file_location(
                        f"desloppify_user_plugin_{f.stem}", f
                    )
                    if spec and spec.loader:
                        try:
                            mod = importlib.util.module_from_spec(spec)
                            spec.loader.exec_module(mod)
                            _register_module_entrypoint(mod)
                        except _PLUGIN_IMPORT_ERRORS as ex:
                            logger.debug(
                                "User plugin import failed for %s: %s", f.name, ex
                            )
                            failures[f"user:{f.name}"] = ex
    except OSError as exc:
        log_best_effort_failure(logger, "discover user plugins", exc)

    state.set_load_errors(failures)
    _report_load_errors_for_load_all()


def reload_all() -> None:
    """Force a full in-process language plugin reload."""
    from desloppify.base.registry import reset_registered_detectors
    from desloppify.engine._scoring.policy.core import reset_registered_scoring_policies

    reset_registered_detectors()
    reset_registered_scoring_policies()
    load_all(force_reload=True)


__all__ = [
    "load_all",
    "raise_load_errors",
    "reload_all",
    "reset_runtime_state",
]
