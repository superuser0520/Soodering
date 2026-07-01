const { app, BrowserWindow, shell } = require("electron");

process.env.PORT = process.env.PORT || "3217";
process.env.SOODEERING_DESKTOP = "1";

require("./server");

const APP_URL = `http://127.0.0.1:${process.env.PORT}`;

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
      nodeIntegration: false
    }
  });

  win.loadURL(APP_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
