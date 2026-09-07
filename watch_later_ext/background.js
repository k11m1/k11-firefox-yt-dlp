// Everything that talks to the native host lives here.
//
// 1.2 opened the native port from popup.js. Firefox ties a port's lifetime to
// the document that created it, and a browser-action popup is destroyed the
// moment it loses focus -- so clicking Download and then clicking back onto the
// page killed the host mid-download, leaving a .part file behind and no error
// anywhere. The port has to belong to the background page, which outlives the
// popup. (The host also detaches the download into a systemd unit, so it now
// survives even the browser quitting.)

const HOST = "watch_later";

const MENU_PARENT = "wl-parent";

// Single-item entries come first, because grabbing one track is the common case
// and following a YouTube Mix by accident drags in dozens of unrelated files.
const MENUS = [
  { id: "wl-audio", title: "Music", mode: "audio", playlist: false },
  { id: "wl-audio-list", title: "Music — whole playlist", mode: "audio", playlist: true },
  { id: "wl-video", title: "Video", mode: "video", playlist: false },
  { id: "wl-video-list", title: "Video — whole playlist", mode: "video", playlist: true },
];

function sendToHost(message) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = browser.runtime.connectNative(HOST);
    } catch (error) {
      reject(new Error(`cannot reach the downloader: ${error.message}`));
      return;
    }

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    port.onMessage.addListener((response) => finish(resolve, response));
    port.onDisconnect.addListener(() => {
      // Firefox reports a port failure on port.error. runtime.lastError is the
      // Chrome idiom and is not populated here, so reading only that turned a
      // perfectly clear "No such native application watch_later" into a
      // useless generic message.
      const error = port.error || browser.runtime.lastError;
      finish(
        reject,
        new Error(
          error
            ? `native host error: ${error.message}`
            : "the downloader exited without replying",
        ),
      );
    });

    port.postMessage(message);
  });
}

function notify(message, title = "Watch Later Downloader") {
  // Completion is reported by the host itself, which is the only side that
  // knows when a detached download actually finished. This is for the failures
  // that never reach the host at all.
  return browser.notifications
    .create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icon-48.png"),
      title,
      message,
    })
    .catch((error) => console.warn("watch-later: notification failed", error));
}

async function startDownload(url, mode, playlist = false, title = "") {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("No downloadable URL here (needs http or https)");
  }

  const settings = await wlLoadSettings();
  // Always explicit, never remembered. Whether a playlist is followed is
  // decided by which button or menu entry was used, so it cannot be left
  // switched on from some earlier download.
  settings.playlist = Boolean(playlist);

  const response = await sendToHost({
    action: "download",
    url,
    type: mode,
    // The page title is what the host puts in its notifications: on a video
    // site that is the track name, which beats showing a raw URL.
    title: title || "",
    settings,
  });

  if (response.status === "error") {
    throw new Error(response.reason || "the downloader reported an error");
  }
  return response;
}

// --- Toolbar button --------------------------------------------------------

// Clearing the popup makes the button fire action.onClicked instead of opening
// the chooser, which is what turns defaultMode into a genuine one-click.
async function applyDefaultMode() {
  const { defaultMode } = await wlLoadSettings();
  try {
    await browser.action.setPopup({
      popup: defaultMode === "ask" ? "popup.html" : "",
    });
  } catch (error) {
    console.error("watch-later: could not set popup mode", error);
  }
}

browser.action.onClicked.addListener(async (tab) => {
  const { defaultMode } = await wlLoadSettings();
  if (defaultMode === "ask") return; // the popup is handling it
  try {
    await startDownload(tab && tab.url, defaultMode, false, tab && tab.title);
  } catch (error) {
    await notify(error.message, "Download failed");
  }
});

// --- Context menus ---------------------------------------------------------

// removeAll first: an event page can be restarted, and creating a menu with an
// id that already exists throws.
const MENU_CONTEXTS = ["link", "page", "video", "audio"];

browser.menus
  .removeAll()
  .then(() => {
    browser.menus.create({
      id: MENU_PARENT,
      title: "Download with yt-dlp",
      contexts: MENU_CONTEXTS,
    });
    for (const { id, title } of MENUS) {
      browser.menus.create({
        id,
        title,
        parentId: MENU_PARENT,
        contexts: MENU_CONTEXTS,
      });
    }
  })
  .catch((error) => console.error("watch-later: could not build menus", error));

browser.menus.onClicked.addListener(async (info, tab) => {
  const entry = MENUS.find((item) => item.id === info.menuItemId);
  if (!entry) return;

  // linkUrl first, so grabbing a track from a list of results works without
  // opening it.
  const url = info.linkUrl || info.srcUrl || info.pageUrl || (tab && tab.url);
  try {
    // On a link the page title describes the wrong thing, so prefer the link
    // text; fall back to the page title when the click was on the page itself.
    const label = info.linkUrl ? info.linkText : tab && tab.title;
    await startDownload(url, entry.mode, entry.playlist, label);
  } catch (error) {
    await notify(error.message, "Download failed");
  }
});

// --- Messages from the popup and options pages -----------------------------

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return false;

  if (message.kind === "download") {
    return startDownload(message.url, message.mode, message.playlist, message.title)
      .then((response) => ({ ok: true, response }))
      .catch((error) => ({ ok: false, error: error.message }));
  }

  if (message.kind === "getDefaults") {
    return sendToHost({ action: "getDefaults" })
      .then((response) => ({ ok: true, defaults: response.defaults || {} }))
      .catch((error) => ({ ok: false, error: error.message }));
  }

  return false;
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.defaultMode) applyDefaultMode();
});

applyDefaultMode();
