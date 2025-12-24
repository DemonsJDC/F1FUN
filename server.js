// server.js
// Це сервер на Express:
// 1) віддає статичні файли (наш сайт з /public)
// 2) дає API для leaderboard (/api/*)
// 3) дає API для адмінки (/api/admin/*) + захищає його Basic Auth
// 4) адмінку (/admin/*) теж захищає

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";

dotenv.config();

const app = express();

// Дозволяє fetch з інших доменів (для локалки ок)
app.use(cors());

// Щоб читати JSON в body у POST/PUT
app.use(express.json());
app.use(express.static("public"));


// ==============================
// PATHS (де лежать файли сайту)
// ==============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_DIR = path.join(PUBLIC_DIR, "admin");

// ==========================================
// 0) BASIC AUTH (захист адмінки парольчиком)
// ==========================================

// Розбираємо заголовок Authorization: Basic base64(user:pass)
function parseBasicAuth(req) {
  const h = req.headers.authorization || "";
  const [type, token] = h.split(" ");

  if (type !== "Basic" || !token) return null;

  const decoded = Buffer.from(token, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;

  return {
    user: decoded.slice(0, idx),
    pass: decoded.slice(idx + 1)
  };
}

// Middleware який пропускає тільки якщо логін/пароль вірні
function adminAuth(req, res, next) {
  const u = process.env.ADMIN_USER || "";
  const p = process.env.ADMIN_PASS || "";

  // Якщо ти забув вказати креденшали — краще впасти, ніж відкрити адмінку.
  if (!u || !p) {
    return res.status(500).send("Admin credentials are not set in .env");
  }

  const creds = parseBasicAuth(req);

  if (!creds || creds.user !== u || creds.pass !== p) {
    // Каже браузеру “попроси логін/пароль”
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin"');
    return res.status(401).send("Auth required");
  }

  next();
}

// ==========================================
// 1) STATIC (головний сайт + адмінка)
// ВАЖЛИВО: order middleware має значення!
// ==========================================

// Адмінку віддаємо тільки під adminAuth
app.use("/admin", adminAuth, express.static(ADMIN_DIR));

// Маленький редірект /admin -> /admin/
app.get("/admin", adminAuth, (req, res) => res.redirect("/admin/"));

// Головний сайт (все з /public)
app.use(express.static(PUBLIC_DIR));

// ==========================================
// 2) Points system (очковка)
// ==========================================

// Дефолтна система очок (як в F1, 10 місць)
const DEFAULT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// place -> points
function pointsForPlace(place, pointsArr) {
  const p = Number(place);
  if (!Number.isFinite(p) || p < 1) return 0;

  const idx = Math.trunc(p) - 1;
  return idx >= 0 && idx < pointsArr.length ? pointsArr[idx] : 0;
}

// Пробуємо взяти points_json з app_settings,
// якщо таблиці/ключа нема — повертаємо DEFAULT_POINTS
async function getPointsArray() {
  try {
    const [rows] = await pool.query(
      "SELECT `value` FROM app_settings WHERE `key`='points_json' LIMIT 1"
    );

    if (!rows.length) return DEFAULT_POINTS;

    const parsed = JSON.parse(rows[0].value);
    if (!Array.isArray(parsed)) return DEFAULT_POINTS;

    // чистимо масив: тільки числа >=0
    const cleaned = parsed
      .map(Number)
      .filter(n => Number.isFinite(n) && n >= 0)
      .map(n => Math.trunc(n));

    return cleaned.length ? cleaned : DEFAULT_POINTS;
  } catch {
    return DEFAULT_POINTS;
  }
}

// Зберігаємо нові поінти
async function setPointsArray(pointsArr) {
  const cleaned = pointsArr
    .map(Number)
    .filter(n => Number.isFinite(n) && n >= 0)
    .map(n => Math.trunc(n));

  if (!cleaned.length) throw new Error("Points array is empty");

  const json = JSON.stringify(cleaned);

  await pool.query(
    "INSERT INTO app_settings (`key`,`value`) VALUES ('points_json', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
    [json]
  );

  return cleaned;
}

// ==========================================
// 3) PUBLIC API (для головного сайту)
// ==========================================

// Конфіг (очковка)
app.get("/api/config", async (req, res) => {
  const points = await getPointsArray();
  res.json({
    points,
    rule: "points = points[place-1], якщо place > length — 0"
  });
});

// LEADERBOARD all-time
app.get("/api/leaderboard", async (req, res) => {
  try {
    const points = await getPointsArray();

    // Беремо всі результати і джойнимо імена
    // Таблиця race_results у тебе: driver_id, team_id, map_id, place, time_ms
    const [rows] = await pool.query(`
      SELECT
        r.id        AS result_id,
        r.driver_id AS driver_id,
        d.nickname  AS driver_name,
        r.team_id   AS team_id,
        t.name      AS team_name,
        r.map_id    AS map_id,
        m.name      AS map_name,
        r.place     AS place,
        r.time_ms   AS time_ms
      FROM race_results r
      JOIN drivers d ON d.id = r.driver_id
      LEFT JOIN teams t ON t.id = r.team_id
      JOIN maps m ON m.id = r.map_id
      ORDER BY r.id ASC
    `);

    // Агрегуємо очки по гонщиках
    const drivers = new Map(); // driverId -> { ... }
    // Агрегуємо очки по командах
    const teams = new Map();   // teamId -> { ... }

    for (const row of rows) {
      const pts = pointsForPlace(row.place, points);

      // --- drivers aggregate ---
      if (!drivers.has(row.driver_id)) {
        drivers.set(row.driver_id, {
          id: row.driver_id,
          name: row.driver_name,
          totalPoints: 0,
          resultsCount: 0,
          // “основна команда” = та, що найчастіше зустрічається в race_results
          teamHits: new Map() // teamId -> { name, count }
        });
      }

      const d = drivers.get(row.driver_id);
      d.totalPoints += pts;
      d.resultsCount += 1;

      // порахуємо “частоту” команди для цього драйвера
      if (row.team_id) {
        const hit = d.teamHits.get(row.team_id);
        if (!hit) d.teamHits.set(row.team_id, { name: row.team_name, count: 1 });
        else hit.count += 1;

        // --- teams aggregate ---
        if (!teams.has(row.team_id)) {
          teams.set(row.team_id, {
            id: row.team_id,
            name: row.team_name,
            totalPoints: 0,
            drivers: new Set()
          });
        }
        const t = teams.get(row.team_id);
        t.totalPoints += pts;
        t.drivers.add(row.driver_id);
      }
    }

    // Формуємо масив для віддачі на фронт
    const leaderboard = Array.from(drivers.values())
      .map(d => {
        // Визначаємо “основну” команду (найчастіша)
        let bestTeamId = null;
        let bestTeamName = null;
        let bestCount = 0;

        for (const [tid, v] of d.teamHits.entries()) {
          if (v.count > bestCount) {
            bestCount = v.count;
            bestTeamId = tid;
            bestTeamName = v.name;
          }
        }

        return {
          id: d.id,
          name: d.name,
          teamId: bestTeamId,
          teamName: bestTeamName,
          totalPoints: d.totalPoints,
          resultsCount: d.resultsCount
        };
      })
      .sort((a, b) => {
        // сортуємо по points, потім по кількості стартів
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        return b.resultsCount - a.resultsCount;
      });

    const teamboard = Array.from(teams.values())
      .map(t => ({
        id: t.id,
        name: t.name,
        totalPoints: t.totalPoints,
        driversCount: t.drivers.size
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints);

    res.json({ points, leaderboard, teamboard });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Деталі по гонщику: список всіх його результатів
app.get("/api/driver/:id", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    if (!Number.isFinite(driverId)) return res.status(400).json({ error: "Bad driver id" });

    const points = await getPointsArray();

    const [rows] = await pool.query(
      `
      SELECT
        r.id      AS result_id,
        m.name    AS map_name,
        t.name    AS team_name,
        r.place   AS place,
        r.time_ms AS time_ms
      FROM race_results r
      JOIN maps m ON m.id = r.map_id
      LEFT JOIN teams t ON t.id = r.team_id
      WHERE r.driver_id = ?
      ORDER BY r.id ASC
      `,
      [driverId]
    );

    const details = rows.map(r => ({
      id: r.result_id,
      map: r.map_name,
      team: r.team_name ?? null,
      place: r.place,
      time_ms: r.time_ms,
      points: pointsForPlace(r.place, points)
    }));

    res.json({ driverId, details });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Остання команда гонщика (по останньому запису race_results.id)
app.get("/api/driver/:id/last-team", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    if (!Number.isFinite(driverId)) return res.status(400).json({ error: "Bad driver id" });

    const [rows] = await pool.query(
      `
      SELECT
        r.id AS result_id,
        r.team_id,
        t.name AS team_name
      FROM race_results r
      LEFT JOIN teams t ON t.id = r.team_id
      WHERE r.driver_id = ?
      ORDER BY r.id DESC
      LIMIT 1
      `,
      [driverId]
    );

    // якщо в нього взагалі нема записів
    if (!rows.length) return res.json(null);

    // може бути team_id NULL => team_name буде null
    res.json({
      resultId: rows[0].result_id,
      teamId: rows[0].team_id,
      teamName: rows[0].team_name
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});


// ==========================================
// 4) ADMIN API (CRUD) — все захищено
// ==========================================

app.use("/api/admin", adminAuth);

// ----- points -----
app.get("/api/admin/points", async (req, res) => {
  const points = await getPointsArray();
  res.json({ points });
});

app.put("/api/admin/points", async (req, res) => {
  try {
    const points = req.body?.points;
    if (!Array.isArray(points)) return res.status(400).json({ error: "points must be array" });

    const saved = await setPointsArray(points);
    res.json({ points: saved });
  } catch (e) {
    res.status(400).json({ error: e.message || "bad request" });
  }
});

// ----- drivers -----
app.get("/api/admin/drivers", async (req, res) => {
  const [rows] = await pool.query("SELECT id, nickname FROM drivers ORDER BY id DESC");
  res.json(rows);
});

app.post("/api/admin/drivers", async (req, res) => {
  const nickname = (req.body?.nickname ?? "").trim();
  if (!nickname) return res.status(400).json({ error: "nickname required" });

  const [result] = await pool.query("INSERT INTO drivers (nickname) VALUES (?)", [nickname]);
  res.json({ id: result.insertId, nickname });
});

app.delete("/api/admin/drivers/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

    await pool.query("DELETE FROM drivers WHERE id=?", [id]);
    res.json({ ok: true });
  } catch {
    // якщо є FK на race_results — MySQL не дасть
    res.status(409).json({ error: "Не можу видалити driver: є результати (FK). Спочатку видали results." });
  }
});

// ----- teams -----
app.get("/api/admin/teams", async (req, res) => {
  const [rows] = await pool.query("SELECT id, name FROM teams ORDER BY id DESC");
  res.json(rows);
});

app.post("/api/admin/teams", async (req, res) => {
  const name = (req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });

  const [result] = await pool.query("INSERT INTO teams (name) VALUES (?)", [name]);
  res.json({ id: result.insertId, name });
});

app.delete("/api/admin/teams/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

    await pool.query("DELETE FROM teams WHERE id=?", [id]);
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: "Не можу видалити team: є results з цією team_id (FK)." });
  }
});

// ----- maps -----
app.get("/api/admin/maps", async (req, res) => {
  const [rows] = await pool.query("SELECT id, name FROM maps ORDER BY id DESC");
  res.json(rows);
});

app.post("/api/admin/maps", async (req, res) => {
  const name = (req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });

  const [result] = await pool.query("INSERT INTO maps (name) VALUES (?)", [name]);
  res.json({ id: result.insertId, name });
});

app.delete("/api/admin/maps/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

    await pool.query("DELETE FROM maps WHERE id=?", [id]);
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: "Не можу видалити map: є results з цією map_id (FK)." });
  }
});

// ----- results -----
// list
app.get("/api/admin/results", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);

  const [rows] = await pool.query(
    `
    SELECT
      r.id,
      r.driver_id,
      d.nickname AS driver_name,
      r.team_id,
      t.name AS team_name,
      r.map_id,
      m.name AS map_name,
      r.place,
      r.time_ms
    FROM race_results r
    JOIN drivers d ON d.id = r.driver_id
    LEFT JOIN teams t ON t.id = r.team_id
    JOIN maps m ON m.id = r.map_id
    ORDER BY r.id DESC
    LIMIT ?
    `,
    [limit]
  );

  res.json(rows);
});

// create
app.post("/api/admin/results", async (req, res) => {
  const driver_id = Number(req.body?.driver_id);
  const team_id = req.body?.team_id === null || req.body?.team_id === "" ? null : Number(req.body?.team_id);
  const map_id = Number(req.body?.map_id);
  const place = Number(req.body?.place);

  // time_ms можна не давати
  const time_ms = req.body?.time_ms === null || req.body?.time_ms === "" ? null : Number(req.body?.time_ms);

  if (!Number.isFinite(driver_id) || !Number.isFinite(map_id) || !Number.isFinite(place)) {
    return res.status(400).json({ error: "driver_id, map_id, place required" });
  }

  const [result] = await pool.query(
    `INSERT INTO race_results (driver_id, team_id, map_id, place, time_ms)
     VALUES (?, ?, ?, ?, ?)`,
    [driver_id, Number.isFinite(team_id) ? team_id : null, map_id, place, Number.isFinite(time_ms) ? time_ms : null]
  );

  res.json({ id: result.insertId });
});

// update
app.put("/api/admin/results/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

  const driver_id = Number(req.body?.driver_id);
  const team_id = req.body?.team_id === null || req.body?.team_id === "" ? null : Number(req.body?.team_id);
  const map_id = Number(req.body?.map_id);
  const place = Number(req.body?.place);
  const time_ms = req.body?.time_ms === null || req.body?.time_ms === "" ? null : Number(req.body?.time_ms);

  if (!Number.isFinite(driver_id) || !Number.isFinite(map_id) || !Number.isFinite(place)) {
    return res.status(400).json({ error: "driver_id, map_id, place required" });
  }

  await pool.query(
    `UPDATE race_results
     SET driver_id=?, team_id=?, map_id=?, place=?, time_ms=?
     WHERE id=?`,
    [driver_id, Number.isFinite(team_id) ? team_id : null, map_id, place, Number.isFinite(time_ms) ? time_ms : null, id]
  );

  res.json({ ok: true });
});

// delete
app.delete("/api/admin/results/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });

  await pool.query("DELETE FROM race_results WHERE id=?", [id]);
  res.json({ ok: true });
});

// ==========================================
// START
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Listening:", PORT));
