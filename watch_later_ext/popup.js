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

  document
    .getElementById("videoBtn")
    .addEventListener("click", () => startDownload("video"));
  document
    .getElementById("audioBtn")
    .addEventListener("click", () => startDownload("audio"));
  document.getElementById("settingsLink").addEventListener("click", (event) => {
    event.preventDefault();
    browser.runtime.openOptionsPage();
  });
});

function setButtonsEnabled(enabled) {
  for (const id of ["videoBtn", "audioBtn"]) {
    document.getElementById(id).disabled = !enabled;
  }
}

async function startDownload(mode) {
  setButtonsEnabled(false);
  showStatus(`Starting ${mode} download…`, "loading");

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0] && tabs[0].url;

    const reply = await browser.runtime.sendMessage({ kind: "download", url, mode });

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
      showStatus(dest ? `Downloading into ${dest}` : "Download started", "success");
    }
    setTimeout(() => window.close(), 1800);
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
