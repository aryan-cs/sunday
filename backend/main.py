"""
main.py — Local polling loop.

Runs the pipeline on a configurable interval (default: 10 seconds).
Use this when running the project locally on your own machine.
"""
from __future__ import annotations

import asyncio
import logging

from .action_center_store import append_action_center_entries_from_pipeline_results
from .config import Config
from .errors import ConfigurationError
from .logging_utils import setup_logging
from .pipeline import run_pipeline, send_due_leave_alerts

setup_logging(Config.log_level, force=True)
log = logging.getLogger("smart-calendar")


def _assert_startup_ready() -> None:
    report = Config.validation_report()
    for error in report["errors"]:
        log.error("CONFIG: %s", error)
    for warning in report["warnings"]:
        log.warning("CONFIG: %s", warning)

    if report["errors"]:
        raise ConfigurationError("Startup validation failed.")


async def main() -> None:
    _assert_startup_ready()

    log.info("Smart Calendar starting")
    log.info(
        "LLM provider: %s (%s)",
        Config.active_llm,
        Config.llm_providers[Config.active_llm]["model"],
    )
    log.info("Poll interval: %ds", Config.poll_interval)
    log.info("Max emails per cycle: %d", Config.max_emails_per_cycle)

    while True:
        try:
            results = await run_pipeline()
            if results:
                appended = append_action_center_entries_from_pipeline_results(results)
                failures = sum(1 for result in results if "error" in result)
                log.info(
                    "Handled %d email(s) this cycle (%d succeeded, %d failed)",
                    len(results),
                    len(results) - failures,
                    failures,
                )
                if appended:
                    log.info("Added %d Action Center entr(y/ies) from email processing", appended)

            leave_alerts = await send_due_leave_alerts()
            if leave_alerts:
                failures = sum(1 for result in leave_alerts if "error" in result)
                log.info(
                    "Handled %d leave alert(s) this cycle (%d succeeded, %d failed)",
                    len(leave_alerts),
                    len(leave_alerts) - failures,
                    failures,
                )
        except Exception as exc:
            log.error("Unexpected error in main loop: %s", exc, exc_info=True)

        await asyncio.sleep(Config.poll_interval)


def run() -> None:
    """Run the local polling loop."""
    asyncio.run(main())


if __name__ == "__main__":
    run()
