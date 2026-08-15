import contextlib
import io
import json
import os
import sys
import traceback

# Importing a sibling module (now that it's possible - see the sys.path
# fix in main()) would otherwise leave a __pycache__ directory behind in
# the user's own session, since the workspace is their real project tree,
# not a throwaway build directory.
sys.dont_write_bytecode = True

WORKSPACE = "/workspace"
MAX_EVENTS = 5000
MAX_OUTPUT_CHARS = 200_000

events = []
truncated = False
depth = 0


def safe_repr(value):
    try:
        text = repr(value)
    except Exception:
        return "<unrepresentable>"
    return text if len(text) <= 300 else text[:300] + "...(truncated)"


def snapshot_locals(frame):
    return {name: safe_repr(val) for name, val in frame.f_locals.items() if not name.startswith("__")}


def in_workspace(filename):
    # Synthetic frames (<frozen codecs>, <string>, ...) aren't real paths;
    # realpath() would resolve them against cwd (/workspace) and falsely
    # match, so they must be excluded before ever reaching realpath().
    if filename.startswith("<"):
        return False
    try:
        real = os.path.realpath(filename)
        return os.path.commonpath([real, WORKSPACE]) == WORKSPACE
    except ValueError:
        return False


# Called for every new frame; the *return value* decides whether Python
# keeps calling us for line/return events inside that specific frame.
# Returning None here for anything outside the workspace is what keeps
# us from tracing into the entire standard library on every import.
def trace_calls(frame, event, arg):
    global depth, truncated

    if not in_workspace(frame.f_code.co_filename):
        return None

    if event == "call":
        depth += 1
        return trace_calls

    if event == "line":
        if truncated:
            return None
        if len(events) >= MAX_EVENTS:
            truncated = True
            sys.settrace(None)
            return None
        events.append(
            {
                "file": os.path.relpath(frame.f_code.co_filename, WORKSPACE).replace(os.sep, "/"),
                "line": frame.f_lineno,
                "func": frame.f_code.co_name,
                "depth": depth,
                "locals": snapshot_locals(frame),
            }
        )
        return trace_calls

    if event == "return":
        depth = max(0, depth - 1)
        return None

    return trace_calls


def clip(text):
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return text[:MAX_OUTPUT_CHARS] + "\n...(output truncated)"


def main():
    target = sys.argv[1]
    error = None
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    # Captured at the Python sys.stdout/sys.stderr level (not the raw OS
    # file descriptor), so the container's real stdout stays free for a
    # single JSON envelope written after exec finishes below.
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        sys.settrace(trace_calls)
        try:
            # exec() never gets the "add the script's own directory to
            # sys.path" behavior that `python <script>` gets for free, so a
            # plain `import sibling_module` would otherwise fail even though
            # sibling_module.py sits right next to the entry file.
            sys.path.insert(0, os.path.dirname(os.path.abspath(target)))
            with open(target, "r", encoding="utf-8") as f:
                source = f.read()
            code = compile(source, target, "exec")
            exec(code, {"__name__": "__main__", "__file__": target})
        except SystemExit:
            pass
        except BaseException:
            error = traceback.format_exc()
        finally:
            sys.settrace(None)

    result = {
        "stdout": clip(stdout_buf.getvalue()),
        "stderr": clip(stderr_buf.getvalue()),
        "trace": {"events": events, "truncated": truncated, "error": error},
    }
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
