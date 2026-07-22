const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const { readFile, unlink, writeFile } = require("node:fs/promises");
const path = require("node:path");

process.env.PORT = process.env.PORT || "3217";
process.env.SOODEERING_DESKTOP = "1";

const APP_URL = `http://127.0.0.1:${process.env.PORT}`;

function credentialPath() {
  return path.join(app.getPath("userData"), "credentials.bin");
}

function registerCredentialHandlers() {
  ipcMain.handle("credentials:load", async () => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const encrypted = await readFile(credentialPath());
      return JSON.parse(safeStorage.decryptString(encrypted));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  });

  ipcMain.handle("credentials:save", async (_event, credentials) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable.");
    if (!credentials?.username || !credentials?.password) throw new Error("Username and password are required.");
    await writeFile(credentialPath(), safeStorage.encryptString(JSON.stringify({
      username: String(credentials.username),
      password: String(credentials.password)
    })));
    return true;
  });

  ipcMain.handle("credentials:clear", async () => {
    try {
      await unlink(credentialPath());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return true;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    title: "SooDering",
    backgroundColor: "#f5f7fb",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  win.loadURL(APP_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && parsed.origin === "https://ssip-cafeteria.whew.life") {
      shell.openExternal(parsed.href);
    }
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  registerCredentialHandlers();
  const { startServer } = require("./server");
  await startServer();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
