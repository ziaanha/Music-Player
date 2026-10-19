
const audio = document.querySelector("#audio");
const songGrid = document.querySelector("#song-grid");
const emptyState = document.querySelector("#empty-state");
const searchInput = document.querySelector("#search-input");
const progress = document.querySelector("#progress");
const toast = document.querySelector("#toast");

const sampleSongs = [
  { id: "sample-7", title: "Berry Kisses", artist: "Moonflower", category: "chill", color: "cover-berry", symbol: "♡", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3" },
  { id: "sample-8", title: "Slow Mornings", artist: "Quiet Hours", category: "focus", color: "cover-cream", symbol: "☕", src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3" }
];

let songs = [...sampleSongs];

// ==========================================
// PERSISTENT MUSIC STORAGE — IndexedDB
// ==========================================

const MUSIC_DB_NAME = "zea-music-library";
const MUSIC_STORE = "local-tracks";

function openMusicDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MUSIC_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(MUSIC_STORE)) {
        db.createObjectStore(MUSIC_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveMusicFile(song, file) {
  const db = await openMusicDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MUSIC_STORE, "readwrite");

    transaction.objectStore(MUSIC_STORE).put({
      id: song.id,
      title: song.title,
      artist: song.artist,
      category: "local",
      color: song.color,
      symbol: song.symbol,
      fileName: file.name,
      file: file
    });

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Could not save music."));
    };

    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Saving music was cancelled."));
    };
  });
}

async function loadSavedMusic() {
  const db = await openMusicDB();

  let savedFiles;

  try {
    savedFiles = await new Promise((resolve, reject) => {
      const transaction = db.transaction(MUSIC_STORE, "readonly");
      const request = transaction.objectStore(MUSIC_STORE).getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);

      transaction.onabort = () => {
        reject(transaction.error || new Error("Could not read saved music."));
      };
    });
  } finally {
    db.close();
  }

  for (const saved of savedFiles) {
    if (songs.some(song => song.id === saved.id)) continue;

    songs.push({
      id: saved.id,
      title: saved.title,
      artist: saved.artist,
      category: "local",
      color: saved.color,
      symbol: saved.symbol,
      fileName: saved.fileName,
      file: saved.file,
      src: URL.createObjectURL(saved.file),
      local: true
    });
  }

  renderSongs();
}

// ==========================================
// APP STATE
// ==========================================

let currentSongId = null;
let currentView = "discover";
let currentFilter = "all";
let currentPlaylistId = null;
let likedSongs = new Set(readStorage("zea-liked", []));
let playlists = readStorage("zea-playlists", []);
let shuffleOn = false;
let repeatOn = false;
let shuffledQueue = [];
let shufflePosition = 0;
let toastTimer;

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showToast("Browser storage is unavailable.");
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function currentSong() {
  return songs.find(song => song.id === currentSongId) || null;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function coverMarkup(song, extraClass = "") {
  return `
    <div class="cover-art ${song.color || "cover-rose"} ${extraClass}">
      <span class="cover-symbol">${escapeHTML(song.symbol || "♫")}</span>
    </div>
  `;
}

function getVisibleSongs() {
  let visible = [...songs];
  const query = searchInput.value.trim().toLowerCase();

  if (currentView === "liked") {
    visible = visible.filter(song => likedSongs.has(song.id));
  } else if (currentView === "library") {
    visible = visible.filter(song => song.local);
  } else if (currentView === "playlist") {
    const playlist = playlists.find(item => item.id === currentPlaylistId);
    visible = visible.filter(song => playlist?.songIds.includes(song.id));
  }

  if (currentFilter === "local") {
    visible = visible.filter(song => song.local);
  } else if (currentFilter === "chill" || currentFilter === "focus") {
    visible = visible.filter(song => song.category === currentFilter);
  }

  if (query) {
    visible = visible.filter(song =>
      song.title.toLowerCase().includes(query) ||
      song.artist.toLowerCase().includes(query)
    );
  }

  return visible;
}

function renderSongs() {
  const visibleSongs = getVisibleSongs();

  songGrid.innerHTML = visibleSongs.map(song => {
    const isPlaying = song.id === currentSongId;
    const isLiked = likedSongs.has(song.id);

    return `
      <article class="song-card ${isPlaying ? "is-playing" : ""}"
        data-song-id="${escapeHTML(song.id)}">
        ${coverMarkup(song)}
        <button class="card-play" data-action="play"
          data-id="${escapeHTML(song.id)}"
          aria-label="${isPlaying && !audio.paused ? "Pause" : "Play"} ${escapeHTML(song.title)}">
          ${isPlaying && !audio.paused ? "Ⅱ" : "▶"}
        </button>
        <div class="song-info">
          <div class="song-info-main">
            <h3 title="${escapeHTML(song.title)}">${escapeHTML(song.title)}</h3>
            <p>${escapeHTML(song.artist)}</p>
          </div>
          <button class="card-like ${isLiked ? "liked" : ""}"
            data-action="like" data-id="${escapeHTML(song.id)}"
            aria-label="${isLiked ? "Unlike" : "Like"} ${escapeHTML(song.title)}">
            ${isLiked ? "♥" : "♡"}
          </button>
        </div>
      </article>
    `;
  }).join("");

  emptyState.hidden = visibleSongs.length > 0;

  document.querySelector("#song-count").textContent =
    `${visibleSongs.length} ${visibleSongs.length === 1 ? "song" : "songs"}`;

  document.querySelectorAll(".filter-chip").forEach(button => {
    button.classList.toggle("active", button.dataset.filter === currentFilter);
  });

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });

  renderCurrentSong();
}

function renderCurrentSong() {
  const song = currentSong();

  document.querySelector("#current-title").textContent =
    song ? song.title : "Choose a song";

  document.querySelector("#current-artist").textContent =
    song ? song.artist : "Your next favourite is waiting";

  const cover = document.querySelector("#current-cover");
  cover.className = `current-cover ${song?.color || "cover-rose"}`;
  cover.innerHTML = `<span>${escapeHTML(song?.symbol || "♫")}</span>`;

  const likeButton = document.querySelector("#like-current");
  likeButton.textContent = song && likedSongs.has(song.id) ? "♥" : "♡";
  likeButton.classList.toggle("liked", !!song && likedSongs.has(song.id));

  const playButton = document.querySelector("#play-button");
  playButton.textContent = song && !audio.paused ? "Ⅱ" : "▶";
  playButton.setAttribute("aria-label",
    song && !audio.paused ? "Pause" : "Play");

  document.querySelector("#shuffle-button").classList.toggle("active", shuffleOn);
  document.querySelector("#repeat-button").classList.toggle("active", repeatOn);

  renderCardPlaybackState();
}

function renderCardPlaybackState() {
  document.querySelectorAll(".song-card").forEach(card => {
    const isPlaying = card.dataset.songId === currentSongId;
    card.classList.toggle("is-playing", isPlaying);

    const button = card.querySelector(".card-play");

    if (button) {
      button.textContent = isPlaying && !audio.paused ? "Ⅱ" : "▶";
      button.setAttribute("aria-label",
        `${isPlaying && !audio.paused ? "Pause" : "Play"} ${card.querySelector("h3")?.textContent || "song"}`);
    }
  });
}

function resetProgress() {
  progress.value = 0;
  document.querySelector("#current-time").textContent = "0:00";
  document.querySelector("#duration").textContent = "0:00";
}

async function playSong(id, autoplay = true) {
  const song = songs.find(item => item.id === id);
  if (!song) return;

  const sameSong = currentSongId === id;
  currentSongId = id;

  if (!sameSong) {
    audio.pause();
    audio.src = song.src;
    audio.load();
    resetProgress();
  }

  renderSongs();

  if (autoplay) {
    try {
      await audio.play();
    } catch (error) {
      if (error.name !== "AbortError") {
        showToast(song.local
          ? "This file could not be played. Try another audio format."
          : "Sample audio could not load. Check your internet connection.");
      }
    }
  }

  renderCurrentSong();
}

function togglePlayback() {
  if (!currentSongId) {
    const firstSong = getVisibleSongs()[0] || songs[0];

    if (firstSong) playSong(firstSong.id);
    else showToast("Add some music first.");

    return;
  }

  if (audio.paused) {
    audio.play().catch(() => showToast("This track could not be played."));
  } else {
    audio.pause();
  }
}

function nextSong() {
  const available = getVisibleSongs();
  if (!available.length) return;

  if (repeatOn && currentSongId) {
    playSong(currentSongId);
    return;
  }

  let next;

  if (shuffleOn) {
    if (!shuffledQueue.length || shufflePosition >= shuffledQueue.length) {
      shuffledQueue = available
        .filter(song => song.id !== currentSongId)
        .map(song => song.id);

      for (let i = shuffledQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledQueue[i], shuffledQueue[j]] =
          [shuffledQueue[j], shuffledQueue[i]];
      }

      shufflePosition = 0;
    }

    next = songs.find(song => song.id === shuffledQueue[shufflePosition++]);
  } else {
    const index = available.findIndex(song => song.id === currentSongId);
    next = available[(index + 1 + available.length) % available.length];
  }

  if (next) playSong(next.id);
}

function previousSong() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  const available = getVisibleSongs();
  if (!available.length) return;

  const index = available.findIndex(song => song.id === currentSongId);
  const previous = available[(index - 1 + available.length) % available.length];

  if (previous) playSong(previous.id);
}

function toggleLike(id) {
  if (likedSongs.has(id)) {
    likedSongs.delete(id);
    showToast("Removed from liked songs.");
  } else {
    likedSongs.add(id);
    showToast("Added to your liked songs ♡");
  }

  saveStorage("zea-liked", [...likedSongs]);
  renderSongs();
}

// ==========================================
// ADD MUSIC — SAVE FILES BEFORE DISPLAYING
// ==========================================

async function addLocalFiles(fileList) {
  const files = [...fileList].filter(file =>
    file.type.startsWith("audio/") ||
    /\.(mp3|wav|m4a|aac|ogg|flac|opus|webm)$/i.test(file.name)
  );

  if (!files.length) {
    showToast("Choose audio files to add.");
    return;
  }

  let savedCount = 0;
  let failedCount = 0;

  showToast("Saving your music… please wait ♡");

  for (const file of files) {
    const name = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ");

    const song = {
      id: `local-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`,
      title: name,
      artist: "Your music",
      category: "local",
      color: [
        "cover-rose", "cover-peach", "cover-lilac", "cover-sage",
        "cover-butter", "cover-sky", "cover-berry", "cover-cream"
      ][songs.length % 8],
      symbol: "♫",
      fileName: file.name,
      file: file,
      src: "",
      local: true
    };

    try {
      // Save the actual audio file into browser storage first.
      await saveMusicFile(song, file);

      // Create a playable URL after successful saving.
      song.src = URL.createObjectURL(file);
      songs.push(song);
      savedCount++;
    } catch (error) {
      console.error("Could not save:", file.name, error);
      failedCount++;
    }
  }

  currentView = "discover";
  currentPlaylistId = null;
  currentFilter = "local";

  document.querySelector("#section-title").textContent = "Your music library";

  renderSongs();

  if (savedCount > 0 && failedCount === 0) {
    showToast(`${savedCount} ${savedCount === 1 ? "song" : "songs"} saved to your library ♡`);
  } else if (savedCount > 0) {
    showToast(`${savedCount} saved; ${failedCount} could not be saved.`);
  } else {
    showToast("Music could not be saved. Check browser storage space.");
  }
}

function renderPlaylists() {
  const list = document.querySelector("#playlist-list");

  const defaults = [
    { id: "all", name: "✿ All songs" },
    { id: "chill", name: "☁ Soft & chill" },
    { id: "focus", name: "♡ Slow moments" }
  ];

  list.innerHTML = defaults.map(item =>
    `<button class="playlist-link" data-playlist="${item.id}">${item.name}</button>`
  ).join("") + playlists.map(playlist =>
    `<button class="playlist-link" data-playlist="${escapeHTML(playlist.id)}">♫ ${escapeHTML(playlist.name)}</button>`
  ).join("");
}

function openPlaylist(id) {
  currentView = "playlist";
  currentPlaylistId = id;
  currentFilter = "all";
  searchInput.value = "";

  const playlist = playlists.find(item => item.id === id);

  document.querySelector("#section-title").textContent =
    playlist ? playlist.name : id === "chill" ? "Soft & chill" : "Slow moments";

  renderSongs();
}

function switchView(view) {
  currentView = view;
  currentPlaylistId = null;
  currentFilter = "all";
  searchInput.value = "";

  const titles = {
    discover: "Made for your mood",
    library: "Your music library",
    liked: "Songs you love"
  };

  document.querySelector("#section-title").textContent =
    titles[view] || "Made for your mood";

  renderSongs();
}

// ==========================================
// SONG CARD ACTIONS
// ==========================================

songGrid.addEventListener("click", event => {
  const actionButton = event.target.closest("[data-action]");
  const card = event.target.closest(".song-card");

  if (!card) return;

  if (actionButton?.dataset.action === "like") {
    event.stopPropagation();
    toggleLike(actionButton.dataset.id);
    return;
  }

  if (actionButton?.dataset.action === "play") {
    const id = actionButton.dataset.id;

    if (id === currentSongId && !audio.paused) {
      audio.pause();
    } else {
      playSong(id);
    }

    return;
  }

  const id = card.dataset.songId;

  if (id === currentSongId && !audio.paused) {
    audio.pause();
  } else {
    playSong(id);
  }
});

// ==========================================
// NAVIGATION
// ==========================================

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll(".filter-chip").forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    renderSongs();
  });
});

document.querySelector("#playlist-list").addEventListener("click", event => {
  const button = event.target.closest("[data-playlist]");
  if (!button) return;

  const id = button.dataset.playlist;

  if (id === "all") {
    switchView("discover");
  } else {
    openPlaylist(id);
  }
});

// ==========================================
// FILE UPLOAD CONTROLS
// ==========================================

["file-input", "empty-file-input", "banner-file-input"].forEach(id => {
  document.querySelector(`#${id}`).addEventListener("change", async event => {
    const input = event.target;

    try {
      await addLocalFiles(input.files);
    } finally {
      input.value = "";
    }
  });
});

// ==========================================
// PLAYER CONTROLS
// ==========================================

document.querySelector("#play-button").addEventListener("click", togglePlayback);
document.querySelector("#next-button").addEventListener("click", nextSong);
document.querySelector("#previous-button").addEventListener("click", previousSong);

document.querySelector("#hero-play").addEventListener("click", () => {
  const firstSong = getVisibleSongs()[0] || songs[0];
  if (firstSong) playSong(firstSong.id);
});

document.querySelector("#like-current").addEventListener("click", () => {
  if (currentSongId) toggleLike(currentSongId);
  else showToast("Choose a song first.");
});

document.querySelector("#shuffle-button").addEventListener("click", () => {
  shuffleOn = !shuffleOn;
  shuffledQueue = [];
  shufflePosition = 0;
  renderCurrentSong();
  showToast(shuffleOn ? "Shuffle is on ✨" : "Shuffle is off");
});

document.querySelector("#repeat-button").addEventListener("click", () => {
  repeatOn = !repeatOn;
  renderCurrentSong();
  showToast(repeatOn ? "Repeat current song is on" : "Repeat is off");
});

// ==========================================
// PROGRESS AND VOLUME
// ==========================================

audio.addEventListener("loadedmetadata", () => {
  document.querySelector("#duration").textContent = formatTime(audio.duration);
});

audio.addEventListener("timeupdate", () => {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;

  progress.value = Math.round((audio.currentTime / audio.duration) * 1000);
  document.querySelector("#current-time").textContent = formatTime(audio.currentTime);
});

progress.addEventListener("input", () => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = (Number(progress.value) / 1000) * audio.duration;
  }
});

const savedVolume = readStorage("zea-volume", 0.75);
audio.volume = Math.min(1, Math.max(0, Number(savedVolume) || 0));
document.querySelector("#volume").value = audio.volume;

document.querySelector("#volume").addEventListener("input", event => {
  audio.volume = Number(event.target.value);
  saveStorage("zea-volume", audio.volume);
});

audio.addEventListener("play", renderCurrentSong);
audio.addEventListener("pause", renderCurrentSong);

audio.addEventListener("ended", () => {
  if (repeatOn) {
    audio.currentTime = 0;
    audio.play().catch(() => showToast("Unable to replay this track."));
  } else {
    nextSong();
  }
});

audio.addEventListener("error", () => {
  if (currentSongId) {
    const song = currentSong();

    if (song) {
      showToast(song.local
        ? "Could not read this audio file. Try another format."
        : "Sample track unavailable. Check your internet connection.");
    }
  }
});

// ==========================================
// SEARCH AND KEYBOARD SHORTCUTS
// ==========================================

searchInput.addEventListener("input", renderSongs);

document.addEventListener("keydown", event => {
  const target = event.target;

  const typing = target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;

  if (event.key === "/" && !typing) {
    event.preventDefault();
    searchInput.focus();
  }

  if (event.code === "Space" && !typing && target.tagName !== "BUTTON") {
    event.preventDefault();
    togglePlayback();
  }

  if (event.key === "ArrowRight" && !typing && audio.duration) {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  }

  if (event.key === "ArrowLeft" && !typing && audio.duration) {
    audio.currentTime = Math.max(0, audio.currentTime - 5);
  }
});

// ==========================================
// CREATE PLAYLISTS
// ==========================================

const playlistDialog = document.querySelector("#playlist-dialog");

document.querySelector("#create-playlist").addEventListener("click", () => {
  document.querySelector("#playlist-name").value = "";
  playlistDialog.showModal();
  document.querySelector("#playlist-name").focus();
});

document.querySelector("#cancel-playlist").addEventListener("click", () => {
  playlistDialog.close();
});

document.querySelector("#playlist-form").addEventListener("submit", event => {
  event.preventDefault();

  const name = document.querySelector("#playlist-name").value.trim();
  if (!name) return;

  const playlist = {
    id: `playlist-${Date.now()}`,
    name,
    songIds: []
  };

  playlists.push(playlist);
  saveStorage("zea-playlists", playlists);
  renderPlaylists();
  playlistDialog.close();
  openPlaylist(playlist.id);
  showToast("Your new playlist is ready ♡");
});

// ==========================================
// DAY / NIGHT THEME
// ==========================================

const savedTheme = readStorage("zea-theme", "day");

if (savedTheme === "night") {
  document.body.classList.add("night");
}

function updateThemeButton() {
  const night = document.body.classList.contains("night");

  document.querySelector("#theme-toggle").innerHTML = night
    ? '☀ <span>Switch to day mode</span>'
    : '☾ <span>Switch to night mode</span>';
}

document.querySelector("#theme-toggle").addEventListener("click", () => {
  document.body.classList.toggle("night");

  saveStorage(
    "zea-theme",
    document.body.classList.contains("night") ? "night" : "day"
  );

  updateThemeButton();
});

// ==========================================
// START APP AND RESTORE SAVED MUSIC
// ==========================================

updateThemeButton();
renderPlaylists();
renderSongs();

loadSavedMusic().catch(error => {
  console.error("Could not restore saved music:", error);
  showToast("Could not load saved music. Try refreshing the page.");
});
