#!/usr/bin/env python3
"""Bound one check and terminate its process group if it stops responding."""
import math
import os
import signal
import subprocess
import sys


def stop_group(process):
    groups = {process.pid}
    # Playwright browsers start detached groups. Capture descendants before
    # terminating Node, while their parent relationship is still observable.
    try:
        rows = subprocess.check_output(
            ['ps', '-axo', 'pid=,ppid=,pgid='], text=True, timeout=2
        )
        processes = [tuple(map(int, line.split())) for line in rows.splitlines() if line.strip()]
        descendants = {process.pid}
        while True:
            found = {pid for pid, parent, _ in processes if parent in descendants}
            if found <= descendants:
                break
            descendants.update(found)
        groups.update(group for pid, _, group in processes if pid in descendants)
        groups = {group for group in groups if group > 0 and group != os.getpgrp()}
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'Could not inspect detached descendants: {error}', file=sys.stderr, flush=True)

    def send(sig):
        for group in groups:
            try:
                os.killpg(group, sig)
            except ProcessLookupError:
                pass

    send(signal.SIGTERM)
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    # A browser child can outlive its Node parent, including after SIGTERM.
    send(signal.SIGKILL)
    process.wait()


def main():
    if len(sys.argv) < 3:
        raise SystemExit('usage: run-check-command.py SECONDS COMMAND [ARG ...]')
    seconds = float(sys.argv[1])
    if not math.isfinite(seconds) or seconds <= 0:
        raise SystemExit('check timeout must be a finite positive number')
    process = subprocess.Popen(sys.argv[2:], start_new_session=True)

    def terminate(signum, _frame):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        stop_group(process)
        raise SystemExit(128 + signum)

    previous_term = signal.signal(signal.SIGTERM, terminate)
    try:
        code = process.wait(timeout=seconds)
        return code if code >= 0 else 128 - code
    except subprocess.TimeoutExpired:
        print(f'Check exceeded {seconds:g}s; terminating its process group.', file=sys.stderr, flush=True)
        stop_group(process)
        return 124
    except KeyboardInterrupt:
        stop_group(process)
        return 130
    finally:
        signal.signal(signal.SIGTERM, previous_term)


if __name__ == '__main__':
    sys.exit(main())
