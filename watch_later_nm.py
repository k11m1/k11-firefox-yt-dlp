#!/usr/bin/env python3
"""
Native messaging host for the "Watch Later Downloader" Firefox extension.

Reads one native message from stdin, starts the download in a *detached*
systemd user unit, and answers straight away.

Detaching is not an optimisation.  Firefox destroys a native port when the
document that opened it goes away, and a browser action popup goes away the
moment it loses focus.  A download run inline would therefore be killed as
soon as the user clicked back onto the page.  The unit outlives both the
popup and the browser.

Wire protocol (4-byte little-endian length + JSON, both directions):

    -> {"action": "getDefaults"}
    <- {"status": "ok", "defaults": {...}}

    -> {"action": "download", "url": ..., "type": "audio"|"video",
        "settings": {...}}
    <- {"status": "started", "dest": ..., "unit": ...}
    <- {"status": "error", "reason": ...}

`action` may be absent, which means "download" -- that is the 1.2 protocol.

Progress and completion are reported by the detached worker over
`notify-send`, because by then there is usually no port left to answer on.
"""

import json
import os
import shlex
import shutil
import struct
import subprocess
import sys
import uuid
from pathlib import Path

# --- Configuration ---------------------------------------------------------
#
# The Nix module supplies all of these.  The fallbacks exist so the script
# stays usable on a machine without it (a plain `pip install yt-dlp` box).

YTDLP = os.environ.get("WL_YTDLP") or shutil.which("yt-dlp") or "yt-dlp"
NOTIFY = os.environ.get("WL_NOTIFY") or shutil.which("notify-send")

DEFAULTS = {
    "audioPath": os.environ.get("WL_AUDIO_DIR", "~/Music/youtubedl"),
    "videoPath": os.environ.get("WL_VIDEO_DIR", "~/Videos/youtubedl"),
    "audioFormat": os.environ.get("WL_AUDIO_FORMAT", "best"),
    "audioQuality": os.environ.get("WL_AUDIO_QUALITY", "0"),
    "videoQuality": os.environ.get(
        "WL_VIDEO_QUALITY",
        "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/"
        "best[height<=1080][ext=mp4]",
    ),
    "archive": True,
    "playlist": False,
    "notifications": True,
    "extraArgs": "",
}

# yt-dlp config file per mode, written by the Nix module.  This is layer 1 of
# the merge; settings from the extension are layer 2 and win, because yt-dlp
# lets later arguments override earlier ones.
CONFIGS = {
    "audio": os.environ.get("WL_AUDIO_CONF"),
    "video": os.environ.get("WL_VIDEO_CONF"),
}

# Used only when no config file was supplied, so that a standalone install
# still behaves sensibly.
# The `%(playlist_title|.)s/` prefix gives an optional playlist subfolder.
# The separator must sit *outside* the field: yt-dlp sanitises path separators
# across a whole %(...)s expansion, so "%(playlist_title&{}/|)s" collapses into
# one filename. "." is the no-playlist fallback because an empty one yields a
# leading "/", which makes the path absolute and silently discards --paths.
BUILTIN_ARGS = {
    "audio": [
        # --extract-audio is added unconditionally by build_argv for this mode.
        "--embed-thumbnail",
        "--embed-metadata",
        "--sponsorblock-remove", "music_offtopic",
        "-o", "%(playlist_title|.)s/%(artist,uploader)s - %(track,title)s.%(ext)s",
    ],
    "video": [
        "--merge-output-format", "mp4",
        "-o", "%(playlist_title|.)s/%(title)s.%(ext)s",
    ],
}

MODES = ("audio", "video")


# --- Native messaging framing ----------------------------------------------

def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    msg_len = struct.unpack("<I", raw_len)[0]
    if msg_len == 0:
        return None
    data = b""
    while len(data) < msg_len:
        chunk = sys.stdin.buffer.read(msg_len - len(data))
        if not chunk:
            break
        data += chunk
    return data.decode("utf-8")


def send_message(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def notify(summary, body=""):
    if not NOTIFY:
        return
    text = f"{summary}\n{body}" if body else summary
    try:
        subprocess.run([NOTIFY, "Watch Later Downloader", text], check=False)
    except Exception:
        pass


# --- Building the download -------------------------------------------------

def resolve_dir(raw, fallback):
    """Turn a user-supplied directory into an absolute, sane Path.

    The options page invites paths like `~/Music/watch_later`, and
    `Path("~/x").mkdir()` would cheerfully create a directory literally named
    `~` in the working directory, so expanduser() is not optional here.
    """
    candidate = (raw or "").strip() or fallback
    path = Path(os.path.expanduser(candidate))
    if not path.is_absolute():
        raise ValueError(f"download directory must be absolute: {candidate}")
    if ".." in path.parts:
        raise ValueError(f"download directory must not contain '..': {candidate}")
    return path


def build_argv(url, mode, settings):
    """Assemble the yt-dlp command line for one download.

    Layering, weakest first:  the Nix config file, then the extension's
    settings, then the raw extraArgs escape hatch.
    """
    audio = mode == "audio"

    dest = resolve_dir(
        settings.get("audioPath" if audio else "videoPath"),
        DEFAULTS["audioPath" if audio else "videoPath"],
    )
    dest.mkdir(parents=True, exist_ok=True)

    argv = [YTDLP]

    conf = CONFIGS.get(mode)
    if conf and Path(conf).is_file():
        argv += ["--config-locations", conf]
    else:
        argv += BUILTIN_ARGS[mode]

    argv += ["--paths", str(dest)]

    # A YouTube watch URL carrying &list= (a Mix or autoplay radio) otherwise
    # drags in the entire, often endless, list -- one click produced 22 unwanted
    # tracks. --no-playlist only disambiguates such URLs; a genuine playlist URL
    # still downloads in full, so this is safe as the default.
    argv += ["--yes-playlist"] if settings.get("playlist") else ["--no-playlist"]

    if audio:
        fmt = (settings.get("audioFormat") or DEFAULTS["audioFormat"]).strip()
        quality = (settings.get("audioQuality") or DEFAULTS["audioQuality"]).strip()
        argv += ["--extract-audio", "--audio-format", fmt]
        if quality:
            argv += ["--audio-quality", quality]
    else:
        selector = (settings.get("videoQuality") or DEFAULTS["videoQuality"]).strip()
        if selector:
            argv += ["-f", selector]

    template = (settings.get("audioTemplate" if audio else "videoTemplate") or "").strip()
    if template:
        argv += ["-o", template]

    if settings.get("archive", DEFAULTS["archive"]):
        argv += ["--download-archive", str(dest / ".archive.txt")]

    # Raw escape hatch.  shlex.split, never a shell -- this string reaches us
    # from the extension's options page and must not be interpreted.
    extra = (settings.get("extraArgs") or "").strip()
    if extra:
        argv += shlex.split(extra)

    # Lets the worker tell "downloaded" from "already in the archive".
    argv += ["--print", "after_move:filepath", "--no-simulate", url]

    return argv, dest


# --- Detached worker -------------------------------------------------------

def spawn(argv, dest, mode, notifications):
    """Run the download in a transient systemd user unit.

    Falls back to a plain detached process where systemd is not available.
    """
    payload = json.dumps({
        "argv": argv,
        "mode": mode,
        "dest": str(dest),
        "notifications": bool(notifications),
    })

    unit = f"watch-later-{uuid.uuid4().hex[:12]}"
    worker = [sys.executable, os.path.abspath(__file__), "--worker", payload]

    systemd_run = shutil.which("systemd-run")
    if systemd_run:
        cmd = [
            systemd_run, "--user", "--collect", "--quiet",
            f"--unit={unit}",
            f"--description=yt-dlp {mode} download",
        ]
        # `systemd-run --user` starts the unit in the *user manager's*
        # environment, not ours, so anything the worker needs is passed
        # explicitly.  The WL_* vars carry the Nix wiring (notify-send in
        # particular); the session vars are what notify-send needs to find a
        # notification daemon.
        forward = [
            "DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "WAYLAND_DISPLAY",
            "XDG_RUNTIME_DIR",
        ]
        forward += [key for key in os.environ if key.startswith("WL_")]
        for var in forward:
            if os.environ.get(var):
                cmd.append(f"--setenv={var}={os.environ[var]}")
        cmd += ["--"] + worker
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            return unit
        # Fall through to the plain-process path rather than losing the
        # download because systemd said no.

    subprocess.Popen(
        worker,
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return None


def run_worker(payload):
    """Run one download to completion and report it.  Never talks to stdout."""
    job = json.loads(payload)
    argv = job["argv"]
    mode = job["mode"]
    notifications = job.get("notifications", True)

    def tell(summary, body=""):
        if notifications:
            notify(summary, body)

    try:
        proc = subprocess.run(argv, capture_output=True, text=True)
    except Exception as exc:
        tell(f"{mode.capitalize()} download failed", str(exc))
        return 1

    if proc.returncode != 0:
        lines = [line for line in (proc.stderr or "").splitlines() if line.strip()]
        tell(f"{mode.capitalize()} download failed", lines[-1] if lines else f"yt-dlp exit {proc.returncode}")
        return proc.returncode

    printed = [line for line in (proc.stdout or "").splitlines() if line.strip()]
    if not printed:
        # Exit 0 with nothing printed means every requested item was already
        # recorded in the download archive.
        tell("Already downloaded", "Nothing new to fetch.")
        return 0

    if len(printed) == 1:
        tell("Download finished", Path(printed[0]).name)
    else:
        tell("Download finished", f"{len(printed)} files")
    return 0


# --- Entry point -----------------------------------------------------------

def handle(msg):
    action = msg.get("action") or "download"

    if action == "getDefaults":
        return {"status": "ok", "defaults": DEFAULTS}

    if action != "download":
        return {"status": "error", "reason": f"unknown action: {action}"}

    url = msg.get("url")
    if not url:
        return {"status": "error", "reason": "no_url"}
    if not str(url).startswith(("http://", "https://")):
        return {"status": "error", "reason": "unsupported_url"}

    mode = msg.get("type") or "video"
    if mode not in MODES:
        return {"status": "error", "reason": f"unknown type: {mode}"}

    settings = msg.get("settings") or {}

    try:
        argv, dest = build_argv(url, mode, settings)
    except ValueError as exc:
        return {"status": "error", "reason": str(exc)}
    except OSError as exc:
        return {"status": "error", "reason": f"cannot use download directory: {exc}"}

    notifications = settings.get("notifications", DEFAULTS["notifications"])
    unit = spawn(argv, dest, mode, notifications)

    if notifications:
        notify(f"Starting {mode} download", url)

    return {"status": "started", "mode": mode, "dest": str(dest), "unit": unit}


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--worker":
        sys.exit(run_worker(sys.argv[2]))

    raw = read_message()
    if not raw:
        send_message({"status": "error", "reason": "no_input"})
        sys.exit(1)

    try:
        msg = json.loads(raw)
    except ValueError:
        send_message({"status": "error", "reason": "invalid_json"})
        sys.exit(1)

    response = handle(msg)
    send_message(response)

    if response.get("status") == "error":
        notify("Download failed", response.get("reason", ""))
        sys.exit(1)


if __name__ == "__main__":
    main()
