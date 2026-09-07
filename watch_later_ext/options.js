// Options page. Defaults come from defaults.js; the greyed-out placeholder in
// each box is fetched live from the native host, so what you see as "inherited"
// is what the machine will actually do.

const TEXT_FIELDS = [
  "extraArgs",
  "audioPath",
  "audioFormat",
  "audioQuality",
  "audioTemplate",
  "videoPath",
  "videoQuality",
  "videoTemplate",
];
const CHECKBOXES = ["notifications", "archive"];
const SELECTS = ["defaultMode"];

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  loadHostDefaults();

  document.getElementById("save").addEventListener("click", saveSettings);
  document.getElementById("reset").addEventListener("click", resetToDefaults);
  document.getElementById("export").addEventListener("click", exportSettings);
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });
  document.getElementById("importFile").addEventListener("change", importSettings);
});

async function loadSettings() {
  const settings = await wlLoadSettings();
  for (const id of TEXT_FIELDS) document.getElementById(id).value = settings[id] || "";
  for (const id of CHECKBOXES) document.getElementById(id).checked = Boolean(settings[id]);
  for (const id of SELECTS) document.getElementById(id).value = settings[id];
}

// Ask the host what it would do on its own, and show that as placeholder text.
// Without this the page would have to hardcode a second copy of the machine's
// defaults, which is how 1.2 ended up with four copies that disagreed.
async function loadHostDefaults() {
  let reply;
  try {
    reply = await browser.runtime.sendMessage({ kind: "getDefaults" });
  } catch (error) {
    reply = { ok: false, error: error.message };
  }

  if (!reply || !reply.ok) {
    for (const id of TEXT_FIELDS) {
      document.getElementById(id).placeholder = "(downloader unreachable)";
    }
    showStatus(
      `Could not read the machine's defaults: ${(reply && reply.error) || "no reply"}. ` +
        "Settings still save, but the greyed-out hints are unavailable.",
      "warning",
    );
    return;
  }

  const defaults = reply.defaults;
  for (const id of TEXT_FIELDS) {
    const value = defaults[id];
    document.getElementById(id).placeholder =
      value === undefined || value === "" ? "(set by the machine's preset)" : String(value);
  }
}

function collect() {
  const settings = {};
  for (const id of TEXT_FIELDS) settings[id] = document.getElementById(id).value.trim();
  for (const id of CHECKBOXES) settings[id] = document.getElementById(id).checked;
  for (const id of SELECTS) settings[id] = document.getElementById(id).value;
  return settings;
}

function validate(settings) {
  if (
    settings.audioQuality &&
    !/^[0-9]$/.test(settings.audioQuality) &&
    !/^\d+k$/.test(settings.audioQuality)
  ) {
    return 'Audio quality must be 0-9 or a bitrate like "192k".';
  }

  for (const id of ["audioPath", "videoPath"]) {
    const value = settings[id];
    if (!value) continue;
    if (!value.startsWith("/") && !value.startsWith("~")) {
      return `${id}: must be an absolute path (start with / or ~).`;
    }
    if (value.split("/").includes("..")) {
      return `${id}: must not contain "..".`;
    }
  }

  // The host splits this like a shell would, and an unbalanced quote makes that
  // throw. Catching it here gives a useful message instead of a failed download.
  const quotes = (settings.extraArgs.match(/["']/g) || []).length;
  if (quotes % 2 !== 0) {
    return "Extra arguments have an unbalanced quote.";
  }

  return null;
}

async function saveSettings() {
  const settings = collect();
  const problem = validate(settings);
  if (problem) {
    showStatus(problem, "error");
    return;
  }

  try {
    await browser.storage.local.set(settings);
    showStatus("Settings saved.", "success");
  } catch (error) {
    showStatus(`Error saving settings: ${error.message}`, "error");
  }
}

async function resetToDefaults() {
  if (!confirm("Reset all settings to defaults?")) return;

  // Write the *defaults object*, not the current effective values. 1.2 wrote
  // the resolved strings, which pinned them forever: a machine default could
  // change afterwards and this profile would never pick it up.
  try {
    await browser.storage.local.set({ ...WL_DEFAULTS });
    await loadSettings();
    showStatus("Settings reset — every field now follows the machine again.", "success");
  } catch (error) {
    showStatus(`Error resetting settings: ${error.message}`, "error");
  }
}

// storage.local is per-profile and never leaves the browser, so it is exactly
// the kind of thing a lost profile takes with it. Export gives you a copy.
function exportSettings() {
  const blob = new Blob([JSON.stringify(collect(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "watch-later-settings.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showStatus("Exported watch-later-settings.json.", "success");
}

async function importSettings(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = ""; // so re-picking the same file fires change again
  if (!file) return;

  try {
    const incoming = JSON.parse(await file.text());
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      throw new Error("that file does not contain a settings object");
    }

    // Only take keys we know, so an old or hand-edited file cannot inject junk.
    const known = Object.keys(WL_DEFAULTS);
    const settings = {};
    const ignored = [];
    for (const [key, value] of Object.entries(incoming)) {
      if (known.includes(key)) settings[key] = value;
      else ignored.push(key);
    }
    if (Object.keys(settings).length === 0) {
      throw new Error("no recognised settings in that file");
    }

    await browser.storage.local.set({ ...WL_DEFAULTS, ...settings });
    await loadSettings();

    const note = ignored.length ? ` Ignored unknown key(s): ${ignored.join(", ")}.` : "";
    showStatus(`Imported ${Object.keys(settings).length} setting(s).${note}`, "success");
  } catch (error) {
    showStatus(`Import failed: ${error.message}`, "error");
  }
}

function showStatus(message, type) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = type;
  status.style.display = "block";
  if (type === "success") {
    setTimeout(() => {
      status.style.display = "none";
    }, 4000);
  }
}
