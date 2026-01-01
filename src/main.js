const { app, BrowserWindow, dialog, ipcMain, Notification } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs-extra");
const unzipper = require("unzipper");

/* ───────── GLOBAL STATE ───────── */

let launcherWindow = null;
let currentAppId = "default";

/* Windows identity */
if (process.platform === "win32") {
  app.setAppUserModelId("com.zapps.runtime");
}

/* Paths */
const LIB_PATH = () => path.join(app.getPath("userData"), "library.json");

/* ───────── SELF-REPAIR MODE ───────── */

async function selfRepair() {
  const userData = app.getPath("userData");
  const library = path.join(userData, "library.json");

  try {
    if (!fs.existsSync(userData)) fs.ensureDirSync(userData);
    if (!fs.existsSync(library)) {
      await fs.writeJson(library, [], { spaces: 2 });
    }

    const files = fs.readdirSync(userData);
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          await fs.readJson(path.join(userData, f));
        } catch {
          await fs.writeJson(path.join(userData, f), {}, { spaces: 2 });
        }
      }
    }

    await fs.remove(path.join(app.getPath("temp"), "zapps_runtime"));
  } catch (e) {
    console.error("Self-repair failed:", e);
  }
}

/* ───────── LAUNCHER ───────── */

function createLauncher() {
  launcherWindow = new BrowserWindow({
    width: 820,
    height: 520,
    title: "Zapps",
    icon: path.join(__dirname, "../assets/zapps.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
    }
  });

  launcherWindow.loadFile(
    path.join(__dirname, "../ui/index.html")
  );
}

/* ───────── ZAPP LOADER ───────── */

async function openZappFile(zappFile) {
  const extractDir = path.join(app.getPath("temp"), "zapps_runtime");

  await fs.remove(extractDir);
  await fs.ensureDir(extractDir);

  await fs.createReadStream(zappFile)
    .pipe(unzipper.Extract({ path: extractDir }))
    .promise();

  const manifestPath = path.join(extractDir, "zapp.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("zapp.json not found");
  }

  const manifest = await fs.readJson(manifestPath);
  currentAppId = manifest.id || "unknown_app";

  let iconPath;
  if (manifest.icon) {
    const p = path.join(extractDir, manifest.icon);
    if (fs.existsSync(p)) iconPath = p;
  }

  /* Save to library */
  let lib = [];
  if (fs.existsSync(LIB_PATH())) lib = await fs.readJson(LIB_PATH());
  if (!lib.find(a => a.id === manifest.id)) {
    lib.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      icon: manifest.icon || null
    });
    await fs.writeJson(LIB_PATH(), lib, { spaces: 2 });
  }

  if (process.platform === "win32" && manifest.id) {
    app.setAppUserModelId(manifest.id);
  }

  const win = new BrowserWindow({
    width: manifest.window?.width || 800,
    height: manifest.window?.height || 600,
    resizable: manifest.window?.resizable ?? true,
    title: manifest.name || "Zapp",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true
    }
  });

  win.loadFile(path.join(extractDir, manifest.entry));
}

/* ───────── IPC API ───────── */

ipcMain.handle("zapps:open", async () => {
  const r = await dialog.showOpenDialog({
    filters: [{ name: "Zapps App", extensions: ["zapp"] }],
    properties: ["openFile"]
  });
  if (!r.canceled) await openZappFile(r.filePaths[0]);
});

ipcMain.on("zapps:notify", (_, { title, body }) => {
  new Notification({ title: title || "Zapps", body: body || "" }).show();
});

ipcMain.handle("zapps:storage:get", async (_, key) => {
  const p = path.join(app.getPath("userData"), `${currentAppId}.json`);
  if (!fs.existsSync(p)) return null;
  return (await fs.readJson(p))[key] ?? null;
});

ipcMain.handle("zapps:storage:set", async (_, { key, value }) => {
  const p = path.join(app.getPath("userData"), `${currentAppId}.json`);
  let d = {};
  if (fs.existsSync(p)) d = await fs.readJson(p);
  d[key] = value;
  await fs.writeJson(p, d, { spaces: 2 });
});

ipcMain.handle("zapps:library", async () => {
  if (!fs.existsSync(LIB_PATH())) return [];
  return await fs.readJson(LIB_PATH());
});

/* ───────── AUTO-UPDATE UI ───────── */

function setupAutoUpdaterUI() {
  autoUpdater.on("checking-for-update", () =>
    launcherWindow?.webContents.send("zapps:update:status", "Checking for updates…")
  );

  autoUpdater.on("update-available", () =>
    launcherWindow?.webContents.send("zapps:update:status", "Update found. Downloading…")
  );

  autoUpdater.on("update-not-available", () =>
    launcherWindow?.webContents.send("zapps:update:status", "Zapps is up to date.")
  );

  autoUpdater.on("download-progress", p =>
    launcherWindow?.webContents.send("zapps:update:progress", Math.round(p.percent))
  );

  autoUpdater.on("update-downloaded", () =>
    launcherWindow?.webContents.send("zapps:update:status", "Update ready. Restart to apply.")
  );
}

ipcMain.on("zapps:update:restart", () => {
  autoUpdater.quitAndInstall();
});

/* ───────── BOOT ───────── */

app.whenReady().then(async () => {
  await selfRepair();
  setupAutoUpdaterUI();
  autoUpdater.checkForUpdates();

  const zappArg = process.argv.find(a => a.endsWith(".zapp"));
  if (zappArg) openZappFile(zappArg);
  else createLauncher();
});
