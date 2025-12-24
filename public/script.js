// script.js

const racersContainer = document.getElementById("racers-container");
const teamContainer = document.getElementById("team-container");
const pointsHint = document.getElementById("pointsHint");

const scrollContainer = document.querySelector(".main-listbg"); // твій скролл-блок

// кеші
const detailsCache = new Map();   // driverId -> payload from /api/driver/:id
const lastTeamCache = new Map();  // driverId -> teamName|null

// мапа: назва команди -> css клас
const TEAM_CLASS = {
  "Sauber": "racerSauber",
  "Ferrari": "racerFerrari",
  "Red Bull": "racerRedbull",
  "Mercedes": "racerMercedes",
  "McLaren": "racerMclaren",
  "Haas": "racerHaas",
  "Racing Bulls": "racerRacingbulls",
  "Alpine": "racerAlpine",
  "Aston Martin": "racerAstonmartin",
  "Williams": "racerWilliams"
};

// нормалізація назв
function normTeamName(name) {
  return String(name || "").trim().toLowerCase();
}

const TEAM_CLASS_NORM = Object.fromEntries(
  Object.entries(TEAM_CLASS).map(([k, v]) => [normTeamName(k), v])
);

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ✅ підтягнути останню команду і додати CSS клас
async function applyLastTeamClass(driverId, el) {
  if (lastTeamCache.has(driverId)) {
    const teamName = lastTeamCache.get(driverId);
    const teamClass = TEAM_CLASS_NORM[normTeamName(teamName)];
    if (teamClass) el.classList.add(teamClass);
    return;
  }

  try {
    const last = await fetchJSON(`/api/driver/${driverId}/last-team`);
    const teamName = last?.teamName ?? null;

    lastTeamCache.set(driverId, teamName);

    const teamClass = TEAM_CLASS_NORM[normTeamName(teamName)];
    if (teamClass) el.classList.add(teamClass);
  } catch (e) {
    console.warn("last-team failed for", driverId, e.message);
    lastTeamCache.set(driverId, null);
  }
}

// формат ms у m:ss.mmm
function formatTimeMs(ms) {
  if (ms === null || ms === undefined) return "-";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "-";

  const total = Math.max(0, Math.trunc(n));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;

  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

function clearUI() {
  racersContainer.innerHTML = "";
  teamContainer.innerHTML = "";
}

/* ------------------------------
   FLOATING DETAILS (не ріже overflow)
--------------------------------- */

let activeDetails = null; // { box, anchorEl, driverId }
let repositionRAF = null;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function positionDetails(box, anchorEl) {
  const r = anchorEl.getBoundingClientRect();

  // ширина popup під ширину картки (з відступами)
  const w = Math.max(240, r.width - 24);

  let left = r.left + 12;
  let top = r.bottom + 8;

  // щоб не вилітало за екран
  left = clamp(left, 8, window.innerWidth - w - 8);

  // якщо вниз не влазить — показуємо над карткою
  const h = box.offsetHeight || 180;
  if (top + h > window.innerHeight - 8) {
    top = r.top - h - 8;
  }
  top = clamp(top, 8, window.innerHeight - h - 8);

  box.style.width = w + "px";
  box.style.left = left + "px";
  box.style.top = top + "px";
}

function scheduleReposition() {
  if (!activeDetails) return;
  if (repositionRAF) cancelAnimationFrame(repositionRAF);

  repositionRAF = requestAnimationFrame(() => {
    if (!activeDetails) return;
    positionDetails(activeDetails.box, activeDetails.anchorEl);
  });
}

function closeActiveDetails() {
  if (!activeDetails) return;

  const { box } = activeDetails;
  activeDetails = null;

  box.classList.remove("details--show");
  box.addEventListener("transitionend", () => box.remove(), { once: true });

  window.removeEventListener("scroll", scheduleReposition, true);
  window.removeEventListener("resize", scheduleReposition);
  if (scrollContainer) scrollContainer.removeEventListener("scroll", scheduleReposition);
}

async function showDetails(driverId, anchorEl) {
  if (anchorEl.dataset.hovered !== "1") return;

  // якщо вже відкрито — закриваємо
  closeActiveDetails();

  // створюємо popup в body
  const box = document.createElement("div");
  box.className = "details details-floating";
  box.textContent = "Loading...";
  document.body.appendChild(box);

  activeDetails = { box, anchorEl, driverId };

  // позиція + анімація
  positionDetails(box, anchorEl);
  requestAnimationFrame(() => box.classList.add("details--show"));

  // тримати позицію при скролі/resize
  window.addEventListener("scroll", scheduleReposition, true);
  window.addEventListener("resize", scheduleReposition);
  if (scrollContainer) scrollContainer.addEventListener("scroll", scheduleReposition);

  try {
    let payload = detailsCache.get(driverId);
    if (!payload) {
      payload = await fetchJSON(`/api/driver/${driverId}`);
      detailsCache.set(driverId, payload);
    }

    // якщо вже не hover або popup змінився — не оновлюємо
    if (!activeDetails || activeDetails.driverId !== driverId || anchorEl.dataset.hovered !== "1") {
      closeActiveDetails();
      return;
    }

    const details = payload.details || [];
    if (!details.length) {
      box.textContent = "No results for this driver.";
      positionDetails(box, anchorEl);
      return;
    }

    box.innerHTML = details
      .map((r) => `
        <div class="drow">
          <div>🏁 ${r.map}${r.team ? ` • ${r.team}` : ""}</div>
          <div>place ${r.place} • ${formatTimeMs(r.time_ms)} • +${r.points}</div>
        </div>
      `)
      .join("");

    // висота змінилась — перепозиціонуємо
    positionDetails(box, anchorEl);
  } catch (e) {
    box.textContent = `Error loading details: ${e.message}`;
    positionDetails(box, anchorEl);
  }
}

/* ------------------------------
   MAIN LOAD
--------------------------------- */

async function loadLeaderboard() {
  clearUI();

  // config
  const cfg = await fetchJSON("/api/config");
  pointsHint.textContent = `Points: ${cfg.points.join("-")}`;

  // leaderboard
  const data = await fetchJSON("/api/leaderboard");

  // racers
  data.leaderboard.forEach((r, idx) => {
    const el = document.createElement("div");
    el.className = "racer";

    // last team class
    applyLastTeamClass(r.id, el);

    el.innerHTML = `
      <div class="left">
        <div class="name">${idx + 1}. ${r.name}</div>
        <div class="sub">${r.teamName ? `Team: ${r.teamName}` : "No team"} • starts: ${r.resultsCount}</div>
      </div>
      <div class="points">${r.totalPoints}</div>
    `;

    let timer = null;

    el.addEventListener("mouseenter", () => {
      el.dataset.hovered = "1";
      timer = setTimeout(() => showDetails(r.id, el), 120);
    });

    el.addEventListener("mouseleave", () => {
      el.dataset.hovered = "0";
      if (timer) clearTimeout(timer);
      timer = null;
      closeActiveDetails();
    });

    racersContainer.appendChild(el);
  });

  // teams
  data.teamboard.forEach((t, idx) => {
    const el = document.createElement("div");
    el.className = "teamRow";
    el.innerHTML = `<div>${idx + 1}. ${t.name}</div><div><b>${t.totalPoints}</b></div>`;
    teamContainer.appendChild(el);
  });
}

// старт
loadLeaderboard().catch((err) => {
  console.error(err);
  pointsHint.textContent = "Error loading (check console).";
});
