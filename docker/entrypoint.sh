#!/usr/bin/env bash
set -e

# Belt-and-suspenders resource limits, enforced *inside* the container
# regardless of whether the caller also passed --memory/--cpus/--pids-limit
# to `docker run`. ulimit values here are per-process.

# CPU seconds, not wall clock. Set low relative to the wall-clock timeout
# below: --cpus 0.5 throttles the container to half a core, so reaching
# N CPU-seconds takes roughly 2N wall-clock seconds. This must fire before
# the wall-clock backstop or a CPU-bound busy loop never trips it at all.
ulimit -t 5
ulimit -v 524288    # virtual memory, in KB (~512MB)
ulimit -u 32        # max processes/threads for this user (stops fork bombs)
ulimit -f 10240     # max file size the process may write, in KB (~10MB)

# ulimit -t only bounds CPU time, so a loop that sleeps instead of
# spinning (e.g. `while True: time.sleep(1)`) would never trip it.
# A wall-clock timeout is the backstop that catches that case too.
exec timeout --signal=KILL 15 "$@"
