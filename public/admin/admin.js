// admin.js
// Тут вся логіка CRUD для адмінки.
// Працює через fetch на /api/admin/*
// Пам’ятай: ці ендпоінти захищені Basic Auth (браузер сам просить пароль)

const pointsInput = document.getElementById("pointsInput");
const savePointsBtn = document.getElementById("savePointsBtn");
const pointsMsg = document.getElementById("pointsMsg");

const driverName = document.getElementById("driverName");
const addDriverBtn = document.getElementById("addDriverBtn");
const driversList = document.getElementById("driversList");

const teamName = document.getElementById("teamName");
const addTeamBtn = document.getElementById("addTeamBtn");
const teamsList = document.getElementById("teamsList");

const mapName = document.getElementById("mapName");
const addMapBtn = document.getElementById("addMapBtn");
const mapsList = document.getElementById("mapsList");

const resDriver = document.getElementById("resDriver");
const resTeam = document.getElementById("resTeam");
const resMap = document.getElementById("resMap");
const resPlace = document.getElementById("resPlace");
const resTime = document.getElementById("resTime");

const addResultBtn = document.getElementById("addResultBtn");
const reloadAllBtn = document.getElementById("reloadAllBtn");
const resultsMsg = document.getElementById("resultsMsg");
const resultsList = document.getElementById("resultsList");

// Універсальний fetch helper
async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function setMsg(el, text, isBad=false) {
  el.textContent = text;
  el.style.color = isBad ? "rgba(255,160,160,0.95)" : "rgba(180,255,200,0.95)";
  if (!text) el.style.color = "";
}

function clearSelect(sel) {
  sel.innerHTML = "";
}

function addOption(sel, value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  sel.appendChild(o);
}

// Формат часу з ms
function fmtTime(ms) {
  if (ms === null || ms === undefined) return "-";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "-";
  const total = Math.max(0, Math.trunc(n));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  return `${minutes}:${String(seconds).padStart(2,"0")}.${String(milli).padStart(3,"0")}`;
}

// =====================
// LOADERS
// =====================

async function loadPoints() {
  const data = await fetchJSON("/api/admin/points");
  pointsInput.value = data.points.join(",");
}

async function loadDrivers() {
  const drivers = await fetchJSON("/api/admin/drivers");

  driversList.innerHTML = "";
  clearSelect(resDriver);
  addOption(resDriver, "", "— select —");

  for (const d of drivers) {
    // 1) список з Delete
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="left">
        <div><b>#${d.id}</b> ${d.nickname}</div>
        <div class="meta">drivers.id</div>
      </div>
      <div class="right">
        <button class="danger">Delete</button>
      </div>
    `;

    row.querySelector("button").onclick = async () => {
      if (!confirm(`Delete driver #${d.id}? (зламається якщо є results)`)) return;
      try {
        await fetchJSON(`/api/admin/drivers/${d.id}`, { method: "DELETE" });
        await reloadAll();
      } catch (e) {
        alert(e.message);
      }
    };

    driversList.appendChild(row);

    // 2) dropdown для add result
    addOption(resDriver, d.id, `#${d.id} ${d.nickname}`);
  }
}

async function loadTeams() {
  const teams = await fetchJSON("/api/admin/teams");

  teamsList.innerHTML = "";
  clearSelect(resTeam);
  addOption(resTeam, "", "— none —");

  for (const t of teams) {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="left">
        <div><b>#${t.id}</b> ${t.name}</div>
        <div class="meta">teams.id</div>
      </div>
      <div class="right">
        <button class="danger">Delete</button>
      </div>
    `;

    row.querySelector("button").onclick = async () => {
      if (!confirm(`Delete team #${t.id}? (зламається якщо є results)`)) return;
      try {
        await fetchJSON(`/api/admin/teams/${t.id}`, { method: "DELETE" });
        await reloadAll();
      } catch (e) {
        alert(e.message);
      }
    };

    teamsList.appendChild(row);
    addOption(resTeam, t.id, `#${t.id} ${t.name}`);
  }
}

async function loadMaps() {
  const maps = await fetchJSON("/api/admin/maps");

  mapsList.innerHTML = "";
  clearSelect(resMap);
  addOption(resMap, "", "— select —");

  for (const m of maps) {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div class="left">
        <div><b>#${m.id}</b> ${m.name}</div>
        <div class="meta">maps.id</div>
      </div>
      <div class="right">
        <button class="danger">Delete</button>
      </div>
    `;

    row.querySelector("button").onclick = async () => {
      if (!confirm(`Delete map #${m.id}? (зламається якщо є results)`)) return;
      try {
        await fetchJSON(`/api/admin/maps/${m.id}`, { method: "DELETE" });
        await reloadAll();
      } catch (e) {
        alert(e.message);
      }
    };

    mapsList.appendChild(row);
    addOption(resMap, m.id, `#${m.id} ${m.name}`);
  }
}

async function loadResults() {
  const rows = await fetchJSON("/api/admin/results?limit=200");
  resultsList.innerHTML = "";

  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "item";

    row.innerHTML = `
      <div class="left">
        <div>
          <b>#${r.id}</b> • ${r.driver_name}
          ${r.team_name ? ` • ${r.team_name}` : ""}
          • ${r.map_name}
        </div>
        <div class="meta">
          place ${r.place} • time ${fmtTime(r.time_ms)}
          • (driver:${r.driver_id} team:${r.team_id ?? "-"} map:${r.map_id})
        </div>
      </div>
      <div class="right">
        <button class="ghost">Edit</button>
        <button class="danger">Delete</button>
      </div>
    `;

    // Delete
    row.querySelectorAll("button")[1].onclick = async () => {
      if (!confirm(`Delete result #${r.id}?`)) return;
      try {
        await fetchJSON(`/api/admin/results/${r.id}`, { method: "DELETE" });
        await loadResults();
      } catch (e) {
        alert(e.message);
      }
    };

    // Edit (простий варіант: підставляємо у форму зверху)
    row.querySelectorAll("button")[0].onclick = () => {
      // Просто “заливаємо” поточні значення у форму
      resDriver.value = String(r.driver_id);
      resTeam.value = r.team_id ? String(r.team_id) : "";
      resMap.value = String(r.map_id);
      resPlace.value = String(r.place);
      resTime.value = r.time_ms ?? "";

      // Міняємо кнопку Add Result на “Update”
      addResultBtn.textContent = `Update #${r.id}`;
      addResultBtn.dataset.editId = String(r.id);
      setMsg(resultsMsg, `Editing result #${r.id} (натисни Update)`);
    };

    resultsList.appendChild(row);
  }
}

// reload everything
async function reloadAll() {
  setMsg(pointsMsg, "");
  setMsg(resultsMsg, "");

  await Promise.all([
    loadPoints(),
    loadDrivers(),
    loadTeams(),
    loadMaps(),
    loadResults()
  ]);

  // reset кнопки
  addResultBtn.textContent = "Add Result";
  delete addResultBtn.dataset.editId;
}

// =====================
// ACTIONS
// =====================

// Save points
savePointsBtn.onclick = async () => {
  try {
    const raw = pointsInput.value.trim();

    // "25,18,..." -> [25,18,...]
    const arr = raw
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number);

    const data = await fetchJSON("/api/admin/points", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: arr })
    });

    pointsInput.value = data.points.join(",");
    setMsg(pointsMsg, "Saved ✅");
  } catch (e) {
    setMsg(pointsMsg, e.message, true);
  }
};

// Add driver
addDriverBtn.onclick = async () => {
  try {
    const nickname = driverName.value.trim();
    if (!nickname) return;

    await fetchJSON("/api/admin/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname })
    });

    driverName.value = "";
    await loadDrivers();
  } catch (e) {
    alert(e.message);
  }
};

// Add team
addTeamBtn.onclick = async () => {
  try {
    const name = teamName.value.trim();
    if (!name) return;

    await fetchJSON("/api/admin/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    teamName.value = "";
    await loadTeams();
  } catch (e) {
    alert(e.message);
  }
};

// Add map
addMapBtn.onclick = async () => {
  try {
    const name = mapName.value.trim();
    if (!name) return;

    await fetchJSON("/api/admin/maps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    mapName.value = "";
    await loadMaps();
  } catch (e) {
    alert(e.message);
  }
};

// Add/Update result
addResultBtn.onclick = async () => {
  try {
    const payload = {
      driver_id: resDriver.value,
      team_id: resTeam.value || null,
      map_id: resMap.value,
      place: resPlace.value,
      time_ms: resTime.value || null
    };

    const editId = addResultBtn.dataset.editId;

    if (editId) {
      // UPDATE
      await fetchJSON(`/api/admin/results/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      setMsg(resultsMsg, `Updated #${editId} ✅`);
    } else {
      // CREATE
      await fetchJSON("/api/admin/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      setMsg(resultsMsg, "Added ✅");
    }

    // reset form
    resPlace.value = "";
    resTime.value = "";

    // reset edit state
    addResultBtn.textContent = "Add Result";
    delete addResultBtn.dataset.editId;

    await loadResults();
  } catch (e) {
    setMsg(resultsMsg, e.message, true);
  }
};

reloadAllBtn.onclick = reloadAll;

// старт адмінки
reloadAll().catch(err => {
  console.error(err);
  alert("Admin load error. Check console.");
});
