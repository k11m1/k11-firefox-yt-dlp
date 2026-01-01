#!/usr/bin/env python3
"""
Native messaging host for Firefox.

This script reads a single native message (4-byte little-endian length + JSON payload),
extracts the `url` field, downloads with yt-dlp, and sends a JSON response back.

Placed at `watch_later_nm.sh` to keep existing native host registration unchanged.
"""

import os
import sys
import struct
import json
import subprocess
import shutil
from pathlib import Path

def notify(summary, body=""):
    try:
        if body:
            # subprocess.run(["notify-send", "Watch Later Downloader", f"{summary}: {body}"], check=False)
            subprocess.run(["notify-send", "Watch Later Downloader", f"{summary}\n{body}"], check=False)
        else:
            subprocess.run(["notify-send", "Watch Later Downloader", summary], check=False)
    except Exception:
        pass

def read_message():
    # Read 4 bytes for message length (little-endian unsigned int)
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len:
        return None
    if len(raw_len) < 4:
        return None
    msg_len = struct.unpack('<I', raw_len)[0]
    if msg_len == 0:
        return None
    data = sys.stdin.buffer.read(msg_len)
    # If we didn't get all bytes, keep reading
    while len(data) < msg_len:
        more = sys.stdin.buffer.read(msg_len - len(data))
        if not more:
            break
        data += more
    return data.decode('utf-8')

def send_message(obj):
    data = json.dumps(obj).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

def main():
    # notify("DEBUG START!.")

    DOWNLOAD_DIR = Path.home() / "watch_later_smaz"
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    os.chdir(DOWNLOAD_DIR)

    raw = read_message()
    # notify("DEBUG stage 2!.")

    if not raw:
        notify("No input received from Firefox native messaging.")
        send_message({"status": "error", "reason": "no_input"})
        sys.exit(1)

    try:
        msg = json.loads(raw)
    except Exception as e:
        notify("Failed to parse JSON", str(e))
        send_message({"status": "error", "reason": "invalid_json"})
        sys.exit(1)

    url = msg.get('url')
    if not url:
        notify("No URL received.")
        send_message({"status": "error", "reason": "no_url"})
        sys.exit(1)

    notify("Starting download", url)
  

    # Build yt-dlp args and decide how to invoke it (system yt-dlp or nix run)
    ytdlp_args = ['-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]', '--merge-output-format', 'mp4']
    if shutil.which('yt-dlp'):
        prefix = [shutil.which('yt-dlp')]
    else:
        prefix = ['nix', 'run', 'nixpkgs#yt-dlp', '--']

    # First, try to resolve the final filename yt-dlp would use
    filename = None
    try:
        cmd_get = prefix + ['--get-filename'] + ytdlp_args + [url]
        pget = subprocess.run(cmd_get, check=True, capture_output=True, text=True)
        out_get = (pget.stdout or "").strip()
        if out_get:
            # take the last non-empty line as the filename
            lines = [l for l in out_get.splitlines() if l.strip()]
            if lines:
                filename = lines[-1].strip()
    except Exception:
        # If we can't determine filename, fall back to letting yt-dlp pick one
        filename = None

    if filename:
        # Ensure we only use the basename (in case get-filename returned a path)
        filename_only = Path(filename).name
        output_path = str(DOWNLOAD_DIR / filename_only)
    else:
        # Fallback template (title + ext) if we couldn't resolve exact name
        output_path = str(DOWNLOAD_DIR / '%(title)s.%(ext)s')

    # Now run the actual download with -o to ensure it goes into DOWNLOAD_DIR and we know the filename
    download_cmd = prefix + ['-o', output_path] + ytdlp_args + [url]
    try:
        proc = subprocess.run(download_cmd, check=False, capture_output=True, text=True)
        rc = proc.returncode
        stdout = (proc.stdout or "").strip()
        stderr = (proc.stderr or "").strip()
    except Exception as e:
        notify("Download failed", str(e))
        send_message({"status": "error", "reason": "download_failed", "detail": str(e)})
        sys.exit(1)

    if rc != 0:
        short = None
        if stderr:
            lines = [l for l in stderr.splitlines() if l.strip()]
            short = lines[-1] if lines else stderr[:200]
        else:
            short = f"yt-dlp exit {rc}"
        notify("Download failed", short)
        send_message({"status": "error", "reason": "download_failed", "detail": short})
        sys.exit(1)

    # Success — determine final filename and a printable title
    final_name = None
    if filename:
        final_name = Path(filename).name
    else:
        # If we used a template, try to infer name from stdout or the output_path
        final_name = Path(output_path).name

    # Derive a simple title (filename without extension)
    try:
        title = Path(final_name).stem
    except Exception:
        title = final_name

    notify("Download finished", f"{final_name}")

    resp = {"status": "ok", "url": url, "filename": final_name, "title": title}
    # include a short snippet of stdout if present
    if stdout:
        resp["detail"] = stdout[:1000]
    send_message(resp)

if __name__ == '__main__':
    main()

