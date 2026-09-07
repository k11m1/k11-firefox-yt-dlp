// The popup does not talk to the native host any more -- background.js owns
// that port, because this document is destroyed as soon as it loses focus and
// took the download with it in 1.2. All this does is ask the background page
// and report what comes back.

document.addEventListener("DOMContentLoaded", () => {
  const urlText = document.getElementById("urlText");
  const buttonGroup = document.getElementById("buttonGroup");

  browser.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const url = tabs[0] && tabs[0].url;
      if (url && /^https?:\/\//i.test(url)) {
        urlText.textContent = url;
        urlText.className = "";
        buttonGroup.style.display = "flex";
        applyPlaylistButtons(url);
      } else {
        urlText.textContent = "No valid URL found (must be http/https)";
        urlText.className = "no-url";
        buttonGroup.style.display = "none";
      }
    })
    .catch((error) => {
      urlText.textContent = `Error getting URL: ${error.message}`;
      urlText.className = "no-url";
    });

  for (const [id, mode, playlist] of BUTTONS) {
    document
      .getElementById(id)
      .addEventListener("click", () => startDownload(mode, playlist));
  }
  document.getElementById("settingsLink").addEventListener("click", (event) => {
    event.preventDefault();
    browser.runtime.openOptionsPage();
  });
});

// A playlist button only makes sense when the URL actually names a playlist.
// Returns null when it does not, so the buttons can be hidden entirely.
function playlistInfo(url) {
  let params;
  try {
    params = new URL(url).searchParams;
  } catch (error) {
    return null;
  }
  const list = params.get("list");
  if (!list) return null;
  return {
    id: list,
    // RD* is YouTube's auto-generated Mix / autoplay radio. It is effectively
    // endless, and following one by accident is what produced 67 unwanted files.
    mix: /^RD/i.test(list),
    // A playlist URL with no v= names no single video, so yt-dlp downloads the
    // whole list whatever we pass. Offering a single-item button there would be
    // a lie, so it gets hidden.
    pure: !params.get("v"),
  };
}

function applyPlaylistButtons(url) {
  const info = playlistInfo(url);
  for (const [id, mode, playlist] of BUTTONS) {
    const button = document.getElementById(id);

    if (!playlist) {
      // Single-item buttons are meaningless on a bare playlist URL.
      button.hidden = Boolean(info && info.pure);
      continue;
    }

    button.hidden = !info;
    if (!info) continue;
    const kind = mode === "audio" ? "Music" : "Video";
    button.textContent = info.mix
      ? `${kind} — whole Mix (endless)`
      : `${kind} — whole playlist`;
    button.classList.toggle("mix-btn", info.mix);
  }
}

// [element id, mode, follow playlists]
const BUTTONS = [
  ["audioBtn", "audio", false],
  ["audioPlaylistBtn", "audio", true],
  ["videoBtn", "video", false],
  ["videoPlaylistBtn", "video", true],
];

function setButtonsEnabled(enabled) {
  for (const [id] of BUTTONS) {
    document.getElementById(id).disabled = !enabled;
  }
}

async function startDownload(mode, playlist) {
  setButtonsEnabled(false);
  showStatus(
    playlist ? `Starting ${mode} playlist…` : `Starting ${mode} download…`,
    "loading",
  );

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0] && tabs[0].url;

    const reply = await browser.runtime.sendMessage({
      kind: "download",
      url,
      mode,
      playlist: Boolean(playlist),
    });

    // Every branch from here ends in a status change. 1.2 left this line
    // reading "Starting..." forever whenever the host died, which is exactly
    // what made its popup-kills-the-download bug impossible to pin down.
    if (!reply || !reply.ok) {
      showStatus((reply && reply.error) || "the downloader did not respond", "error");
      setButtonsEnabled(true);
      return;
    }

    const { status, dest } = reply.response;
    if (status === "already_downloaded") {
      showStatus("Already downloaded — nothing new to fetch", "success");
    } else {
      showStatus(
        `Running in the background${dest ? ` → ${dest}` : ""}. ` +
          "You will get a notification when it finishes.",
        "success",
      );
    }
    setTimeout(() => window.close(), 2600);
  } catch (error) {
    showStatus(error.message, "error");
    setButtonsEnabled(true);
  }
}

function showStatus(message, type) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = type;
  status.style.display = "block";
}
