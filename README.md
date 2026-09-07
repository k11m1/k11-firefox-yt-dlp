# Watch Later Downloader

A Firefox extension that sends the current page (or a right-clicked link) to
`yt-dlp` on the local machine, as either audio or video.

## How it fits together

```
extension  --connectNative("watch_later")-->  Firefox
                                                 |
                     looks up watch_later.json in its
                     native-messaging-hosts directory
                                                 |
                                                 v
                                        watch_later_nm.py
                                                 |
                              systemd --user transient unit
                                                 |
                                                 v
                                              yt-dlp
```

The download runs in a detached systemd unit, so it survives the popup closing
and the browser quitting. The host answers the extension immediately and reports
the outcome over `notify-send`.

## Settings

Three layers decide the final `yt-dlp` command line, weakest first:

1. a yt-dlp config file, if the caller supplies one (the Nix module does)
2. the extension's own settings, from the options page
3. the **Extra yt-dlp arguments** box, appended last

Leave a field on the options page empty to inherit the machine's default; the
greyed-out placeholder shows what that default currently is, read live from the
host. Settings live in `browser.storage.local`, which is per-profile and never
leaves the browser — use **Export JSON** to keep a copy.

## Build

```bash
make check   # JSON + JS + Python syntax
make xpi     # -> watch_later_ext@k11m1.eu-<version>.xpi
```

Signing happens on addons.mozilla.org. An unlisted version is signed
automatically, without human review.

## Install

### With Nix

The companion NixOS module builds the host, generates the native-messaging
manifest with a store path, and registers it through
`programs.firefox.nativeMessagingHosts.packages`. Nothing is written to `$HOME`,
so the manifest cannot go stale.

### Without Nix

1. Make sure `yt-dlp` is on `PATH` (`ffmpeg` and `AtomicParsley` too, for
   `--embed-thumbnail`).
2. Copy the host manifest into place and point it at this checkout:

   ```bash
   mkdir -p ~/.mozilla/native-messaging-hosts
   sed "s|REPLACE_WITH_ABSOLUTE_PATH_TO|$PWD|" watch_later.json \
     > ~/.mozilla/native-messaging-hosts/watch_later.json
   ```

   The `path` **must** be absolute. A stale path here fails silently, which is
   the single most likely reason this stops working.
3. Install the XPI.

Optional environment variables override the built-in defaults:
`WL_YTDLP`, `WL_NOTIFY`, `WL_AUDIO_CONF`, `WL_VIDEO_CONF`, `WL_AUDIO_DIR`,
`WL_VIDEO_DIR`, `WL_AUDIO_FORMAT`, `WL_AUDIO_QUALITY`, `WL_VIDEO_QUALITY`.

## Troubleshooting

### Changes to the host do not take effect

**Restart Firefox completely.** The native-messaging manifest embeds the host's
absolute path, so with the Nix module a new host means a new manifest *and* a
new Firefox wrapper. Firefox reads `MOZ_SYSTEM_DIR` once, at process start, so a
running instance keeps launching whatever it captured then -- and will silently
go on using the previous host. Reloading the extension does not help.

Check which host the running Firefox would actually launch:

```bash
readlink -f /run/current-system/sw/bin/firefox
tr '\0' '\n' < /proc/$(pgrep -f '/lib/firefox/firefox' | head -1)/environ | grep MOZ_SYSTEM_DIR
```

If those name different store paths, the restart has not happened yet and any
test result is meaningless.

### Downloads

Downloads are ordinary systemd user units:

```bash
systemctl --user list-units 'watch-later-*'
journalctl --user -u watch-later-<id>
```
