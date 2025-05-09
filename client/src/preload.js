const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Управление окном
    windowClose: () => ipcRenderer.send('window-close'),
    windowMinimize: () => ipcRenderer.send('window-minimize'),
    windowMaximize: () => ipcRenderer.send('window-maximize'),

    // Работа с токенами
    setAuthTokens: (tokens) => ipcRenderer.send('set-auth-tokens', tokens),
    getAuthTokens: () => ipcRenderer.invoke('get-auth-tokens'),
    clearAuthTokens: () => ipcRenderer.send('clear-auth-tokens'),
    logout: () => ipcRenderer.send('logout'),

    // Универсальный метод для вызова IPC
    invoke: (method, data) => {
        console.log('IPC Request:', method, data);
        return ipcRenderer.invoke(method, data);
    },
});