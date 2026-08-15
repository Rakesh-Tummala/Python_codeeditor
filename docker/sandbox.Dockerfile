FROM python:3.11-slim

# Non-root, no home directory, no login shell: if code running inside
# this container escapes the Python interpreter, it lands as a
# low-privilege user with nothing useful to do.
RUN useradd --no-create-home --uid 10001 --shell /usr/sbin/nologin sandbox

WORKDIR /workspace

COPY entrypoint.sh /entrypoint.sh
COPY tracer_runner.py /opt/pytrace/tracer_runner.py
RUN chmod +x /entrypoint.sh

USER sandbox

ENTRYPOINT ["/entrypoint.sh"]
