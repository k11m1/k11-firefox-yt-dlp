// Single source of truth for settings defaults.
//
// 1.2 kept these in four places -- background.js, popup.js, options.js and the
// placeholder text in options.html -- and they had already drifted apart. Every
// page loads this file first now.
//
// Paths, formats and templates default to the empty string on purpose. The real
// defaults live on the machine, in the native host, and are fetched with a
// getDefaults message. Empty here means "whatever the host says", so changing a
// machine default takes effect everywhere instead of every browser profile
// pinning its own stale copy of it.

const WL_DEFAULTS = {
  // General
  defaultMode: "ask", // "ask" shows the chooser; "audio"/"video" download at once
  notifications: true,
  archive: true, // skip anything already recorded in the download archive
  // playlist is deliberately not stored: it is chosen per click, by which
  // button or menu entry you use, so it can never be left switched on.
  extraArgs: "", // raw yt-dlp arguments, appended last

  // Audio
  audioPath: "",
  audioFormat: "",
  audioQuality: "",
  audioTemplate: "",

  // Video
  videoPath: "",
  videoQuality: "",
  videoTemplate: "",
};

// Passing the defaults object to storage.get fills in anything unset, so the
// caller always receives a complete settings object.
async function wlLoadSettings() {
  try {
    return await browser.storage.local.get(WL_DEFAULTS);
  } catch (error) {
    console.error("watch-later: could not read settings", error);
    return { ...WL_DEFAULTS };
  }
}
