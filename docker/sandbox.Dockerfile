FROM python:3.11-slim

# git/curl for the terminal and any script that needs them - only useful
# now that the sandbox has outbound network access (see SYSTEM_DESIGN.md).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root, no home directory, no login shell: if code running inside
# this container escapes the Python interpreter, it lands as a
# low-privilege user with nothing useful to do.
RUN useradd --no-create-home --uid 10001 --shell /usr/sbin/nologin sandbox

WORKDIR /workspace

COPY entrypoint.sh /entrypoint.sh
COPY tracer_runner.py /opt/pytrace/tracer_runner.py
RUN chmod +x /entrypoint.sh

# `pip install` as this non-root user would otherwise fail outright - the
# global site-packages/bin dirs are root-owned by default, and there's no
# home directory for a `pip install --user` fallback either.
RUN chown -R sandbox:sandbox /usr/local/lib/python3.11/site-packages /usr/local/bin
# No HOME means pip has nowhere to put its cache; disable it rather than
# giving this user a home directory just for that.
ENV PIP_NO_CACHE_DIR=1

USER sandbox

ENTRYPOINT ["/entrypoint.sh"]
