// client_authgRPC.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { hashPassword, hashPhone } = require('./crypto-utils');

const PROTO_PATHS = [
    path.join(__dirname, '../../proto/service_auth.proto'),
    path.join(__dirname, '../../proto/service_communication.proto')
];

const packageDefinition = protoLoader.loadSync(PROTO_PATHS, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);

const AuthService = protoDescriptor.auth.AuthService;
const RelationshipService = protoDescriptor.communication.RelationshipService;
const SearchService = protoDescriptor.communication.SearchService;

const client_auth = new AuthService('localhost:50051', grpc.credentials.createInsecure());
const client_search = new SearchService('localhost:50051', grpc.credentials.createInsecure());

// Клиентские методы
const authClient = {
    signUpUser: async ({ username, phone, email, password }) => {
        const password_hash = await hashPassword(password);
        const phone_hash = hashPhone(phone);

        console.log(phone);
        
        return new Promise((resolve, reject) => {
            client_auth.signUpUser({ 
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
            client_auth.signInUser({ 
                phone: phone_hash, 
                password 
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    getMe: async ({ access_token }) => {
        return new Promise((resolve, reject) => {
            client_auth.getMe({ access_token }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    refreshToken: async ({ refresh_token }) => {
        return new Promise((resolve, reject) => {
            client_auth.refreshToken({ refresh_token }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    }
};

const relationsipClient = {

};

const searchClient = {
    getSearch: async ({ name, type }) => {
        const request = {
            name,  
            type   
        };

        return new Promise((resolve, reject) => {
            client_search .getSearch(request, (err, response) => {
                if (err) return reject(err); 
                resolve(response); 
            });
        });
    }
};

module.exports = { authClient, relationsipClient, searchClient };