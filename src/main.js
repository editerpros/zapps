const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs-extra");
const unzipper = require("unzipper");

let launcherWindow;
let currentAppId = null;

/* Windows identity */
if (process.platform === "win32") {
  app.setAppUserModelId("com.zapps.runtime");
}

/* Paths */
const USER = () => app.getPath("userData");
const APPS = () => path.join(USER(), "apps");
const LIB = () => path.join(USER(), "library.json");

/* Init */
async function initSystem() {
  await fs.ensureDir(APPS());
  if (!fs.existsSync(LIB())) {
    await fs.writeJson(LIB(), [], { spaces: 2 });
  }
}

/* Library */
async function loadLibrary() {
  return fs.readJson(LIB());
}
async function saveLibrary(data) {
  await fs.writeJson(LIB(), data, { spaces: 2 });
}

/* Install / Update */
async function installOrUpdateZapp(zappPath) {
  const probe = path.join(app.getPath("temp"), "zapps_probe");
  await fs.remove(probe);
  await fs.ensureDir(probe);

  await fs.createReadStream(zappPath)
    .pipe(unzipper.Extract({ path: probe }))
    .promise();

  const manifest = await fs.readJson(path.join(probe, "zapp.json"));
  currentAppId = manifest.id;

  const installed = path.join(APPS(), `${manifest.id}.zapp`);
  await fs.copy(zappPath, installed);

  let lib = await loadLibrary();
  const existing = lib.find(a => a.id === manifest.id);

  if (existing) {
    existing.version = manifest.version;
    existing.name = manifest.name;
  } else {
    lib.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      icon: manifest.icon || null
    });
  }

  await saveLibrary(lib);
  return installed;
}

/* Launch */
async function launchZapp(zappFile) {
  const runtime = path.join(app.getPath("temp"), "zapps_runtime");
  await fs.remove(runtime);
  await fs.ensureDir(runtime);

  await fs.createReadStream(zappFile)
    .pipe(unzipper.Extract({ path: runtime }))
    .promise();

  const manifest = await fs.readJson(path.join(runtime, "zapp.json"));
  currentAppId = manifest.id;

  if (process.platform === "win32") {
    app.setAppUserModelId(manifest.id);
  }

  const win = new BrowserWindow({
    width: manifest.window?.width || 800,
    height: manifest.window?.height || 600,
    title: manifest.name,
    icon: manifest.icon ? path.join(runtime, manifest.icon) : undefined
  });

  win.loadFile(path.join(runtime, manifest.entry));
}

/* Shortcuts */
async function createShortcut(appId, name) {
  const exe = process.execPath;
  const zapp = path.join(APPS(), `${appId}.zapp`);

  await shell.writeShortcutLink(
    path.join(app.getPath("desktop"), `${name}.lnk`),
    { target: exe, args: `"${zapp}"` }
  );

  await shell.writeShortcutLink(
    path.join(app.getPath("appData"),
      "Microsoft/Windows/Start Menu/Programs",
      `${name}.lnk`
    ),
    { target: exe, args: `"${zapp}"` }
  );
}

/* Uninstall */
async function uninstallApp(id) {
  await fs.remove(path.join(APPS(), `${id}.zapp`));
  let lib = await loadLibrary();
  lib = lib.filter(a => a.id !== id);
  await saveLibrary(lib);
}

/* IPC */
ipcMain.handle("zapps:open", async () => {
  const r = await dialog.showOpenDialog({
    filters: [{ name: "Zapp", extensions: ["zapp"] }]
  });
  if (!r.canceled) {
    const installed = await installOrUpdateZapp(r.filePaths[0]);
    await launchZapp(installed);
  }
});

ipcMain.handle("zapps:launch", async (_, id) => {
  const zapp = path.join(APPS(), `${id}.zapp`);
  if (fs.existsSync(zapp)) await launchZapp(zapp);
});

ipcMain.handle("zapps:library", loadLibrary);
ipcMain.handle("zapps:pin", (_, app) => createShortcut(app.id, app.name));
ipcMain.handle("zapps:uninstall", (_, id) => uninstallApp(id));

/* About */
ipcMain.handle("zapps:about", () => ({
  name: "Zapps Runtime",
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron
}));

/* Manual update check */
ipcMain.handle("zapps:checkUpdate", () => {
  autoUpdater.checkForUpdates();
  return { status: "checking" };
});

/* Launcher */
function createLauncher() {
  launcherWindow = new BrowserWindow({
    width: 900,
    height: 600,
    icon: path.join(__dirname, "../assets/zapps.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });
  launcherWindow.loadFile(path.join(__dirname, "../ui/index.html"));
}

/* Boot */
app.whenReady().then(async () => {
  await initSystem();

  const arg = process.argv.find(a => a.endsWith(".zapp"));
  if (arg) {
    const installed = await installOrUpdateZapp(arg);
    await launchZapp(installed);
  } else {
    createLauncher();
  }

  autoUpdater.checkForUpdatesAndNotify();
});
