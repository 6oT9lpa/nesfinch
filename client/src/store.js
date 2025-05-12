const Store = require('electron-store').default;

const store = new Store({
    name: 'auth-tokens',
    encryptionKey: 'acff9326d873e7a27579295287dbf0581b73fc3c03c5ae77dbaac1f01806572c7fa9dc727b5e735825553cb158d6586b30b4ae486e372bcb23ad350377f86eb6ab4b761f2d72bdf96cfacae35249de4ff8869a230ebae853b195f1e1df1cd963d4582f80f0b8e825067b6836236905519b35a9b644b5e12df4aabc127b761d07'
});

module.exports = store;