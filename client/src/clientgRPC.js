// clientgRPC.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { hashPassword, hashPhone } = require('./crypto-utils');

const PROTO_PATH = path.join(__dirname, '../../proto/service.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const AuthService = protoDescriptor.auth.AuthService;
const client = new AuthService('localhost:50051', grpc.credentials.createInsecure());

// Клиентские методы
const authClient = {
    signUpUser: async ({ username, phone, email, password }) => {
        const password_hash = await hashPassword(password);
        const phone_hash = hashPhone(phone);

        console.log(phone);
        
        return new Promise((resolve, reject) => {
            client.signUpUser({ 
                username, 
                phone: phone_hash, 
                email, 
                pasw: password_hash 
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    signInUser: async ({ phone, password }) => {
        const phone_hash = hashPhone(phone); 

        return new Promise((resolve, reject) => {
            client.signInUser({ 
                phone: phone_hash, 
                password 
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    getMe: async () => {
        return new Promise((resolve, reject) => {
            client.getMe({}, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    refreshToken: async ({ refresh_token }) => {
        return new Promise((resolve, reject) => {
            client.refreshToken({ refresh_token }, (err, response) => {
                if (err) {
                    let message = 'Ошибка обновления токена';
                    if (err.code === grpc.status.UNAUTHENTICATED) {
                        message = 'Сессия истекла. Требуется повторный вход.';
                    }
                    return reject(new Error(message));
                }
                resolve(response);
            });
        });
    }
};

module.exports = { authClient };