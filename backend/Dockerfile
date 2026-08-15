FROM python:3.11-slim

# The Docker CLI - execution.py shells out to `docker run` directly, and
# terminal.py talks to the daemon via the Python SDK over the same socket.
# This container never runs its own dockerd; it only ever talks to the
# host's daemon through the socket bind-mounted in at deploy time (see
# docker-compose.yml), spawning sibling sandbox containers, not nested ones.
# docker-cli (the actual `docker` binary) is only a Recommends of docker.io
# on Debian, not a hard dependency - --no-install-recommends alone silently
# omits it, leaving dockerd/docker-proxy installed but no client to run.
RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io docker-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
