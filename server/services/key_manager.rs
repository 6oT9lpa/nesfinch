use tonic::Status;
use rsa::{
    pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey, DecodePublicKey}, 
    Pkcs1v15Encrypt,
    RsaPrivateKey, 
    RsaPublicKey
};
use rand::rngs::OsRng;
use rsa::pkcs8::LineEnding;
use sha2::{Digest, Sha256};
use chrono::{Utc, Duration as ChronoDuration};
use sqlx::PgPool;
use std::path::PathBuf;
use ring::aead;
use tracing::{error, info};
use zeroize::Zeroizing;
use rand::RngCore;
use rand::Rng;
use uuid::Uuid;

// Конфигурация безопасности
const RSA_KEY_SIZE: usize = 2048;
const KEY_FILE_NAME: &str = "encrypted_private_key.bin";
const ENCRYPTION_KEY_SIZE: usize = 32; 

// Защищенная структура для хранения ключевой пары
#[derive(Debug)]
pub struct KeyPair {
    private_key: Zeroizing<String>, 
    public_key: String,
    fingerprint: String,
}

pub struct KeyManager {
    db: PgPool,
    encryption_key: [u8; ENCRYPTION_KEY_SIZE],
}

impl KeyManager {
    pub fn new(db: PgPool) -> Self {
        // Генерация случайного ключа при создании менеджера
        let mut encryption_key = [0u8; ENCRYPTION_KEY_SIZE];
        OsRng.fill_bytes(&mut encryption_key);
        
        info!("Initialized KeyManager with new encryption key");
        
        Self { db, encryption_key }
    }

    // Метод для получения текущего ключа шифрования
    pub fn get_encryption_key(&self) -> [u8; ENCRYPTION_KEY_SIZE] {
        self.encryption_key
    }

    // Генерация ключевой пары с защитой в памяти
    fn generate_keypair() -> Result<KeyPair, Box<dyn std::error::Error>> {
        let mut rng = OsRng;

        let private_key = RsaPrivateKey::new(&mut rng, RSA_KEY_SIZE)?;
        let public_key = RsaPublicKey::from(&private_key);

        let private_pem = Zeroizing::new(private_key.to_pkcs8_pem(LineEnding::LF)?.to_string());
        let public_pem = public_key.to_public_key_pem(LineEnding::LF)?;

        let fingerprint = Self::generate_fingerprint(&public_pem)?;

        Ok(KeyPair {
            private_key: private_pem,
            public_key: public_pem,
            fingerprint,
        })
    }

    // Генерация отпечатка с SHA-256
    pub fn generate_fingerprint(public_key: &str) -> Result<String, Box<dyn std::error::Error>> {
        let mut hasher = Sha256::new();
        hasher.update(public_key.as_bytes());
        Ok(hex::encode(hasher.finalize()))
    }

    // Получение пути к AppData/Local с созданием директории
    fn get_appdata_local_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        if let Some(path) = dirs_next::data_local_dir() {
            let path = path.join("NesFinch");
            std::fs::create_dir_all(&path)?;
            return Ok(path);
        }
        
        let path = std::env::current_dir()?.join("NesFinch_keys");
        std::fs::create_dir_all(&path)?;
        Ok(path)
    }

    // Шифрование данных с AEAD
    pub fn encrypt_data(&self, data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let mut nonce = [0u8; 12];
        OsRng.try_fill(&mut nonce)?;
        
        let sealing_key = aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, &self.encryption_key)?);
        
        let mut in_out = data.to_vec();
        sealing_key.seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::empty(), 
            &mut in_out
        )?;
        
        let mut result = nonce.to_vec();
        result.extend_from_slice(&in_out);
        
        Ok(result)
    }

    // Дешифрование данных
    fn decrypt_data(&self, encrypted: &[u8]) -> Result<Zeroizing<Vec<u8>>, Box<dyn std::error::Error>> {
        if encrypted.len() < 12 {
            return Err("Invalid encrypted data".into());
        }
        
        let (nonce_bytes, ciphertext) = encrypted.split_at(12);
        let nonce = aead::Nonce::try_assume_unique_for_key(nonce_bytes)?;
        
        let opening_key = aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, &self.encryption_key)?);
        
        let mut in_out = ciphertext.to_vec();
        opening_key.open_in_place(nonce, aead::Aad::empty(), &mut in_out)?;
        in_out.truncate(in_out.len() - 16);
        
        Ok(Zeroizing::new(in_out))
    }

    // Сохранение приватного ключа с шифрованием
    fn save_private_key(&self, private_key: &Zeroizing<String>) -> Result<(), Box<dyn std::error::Error>> {
        let appdata_path = Self::get_appdata_local_path()
            .map_err(|e| format!("Failed to get appdata path: {}", e))?;
        
        info!("Saving private key to: {:?}", appdata_path);
        
        let key_path = appdata_path.join(KEY_FILE_NAME);

        let private_key_bytes = private_key.as_bytes();
        
        let encrypted_data = self.encrypt_data(private_key_bytes)
            .map_err(|e| format!("Encryption failed: {}", e))?;

        std::fs::write(&key_path, encrypted_data)
            .map_err(|e| format!("Failed to write to file {:?}: {}", key_path, e))?;

        info!("Private key successfully saved");
        Ok(())
    }

    // Загрузка приватного ключа
    fn load_private_key(&self) -> Result<Zeroizing<String>, Box<dyn std::error::Error>> {
        let appdata_path = Self::get_appdata_local_path()?;
        let key_path = appdata_path.join(KEY_FILE_NAME);
        
        info!("Loading private key from: {:?}", key_path);
        
        let encrypted_data = std::fs::read(key_path)?;
        
        let decrypted = self.decrypt_data(&encrypted_data)?;
        
        let private_key = String::from_utf8(decrypted.to_vec())?;
        Ok(Zeroizing::new(private_key))
    }

    // Генерация ключей для пользователя
    pub async fn generate_user_keys(
        &self,
        user_id: uuid::Uuid,
    ) -> Result<KeyPair, Status> {
        let keypair = Self::generate_keypair().map_err(|e| {
            error!("Key generation error: {:?}", e);
            Status::internal("Key generation error")
        })?;

        let exists: Option<uuid::Uuid> = sqlx::query_scalar!(
            "SELECT id FROM user_keys WHERE fingerprint = $1 AND is_revoked = false",
            keypair.fingerprint
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| {
            error!("Database error: {:?}", e);
            Status::internal("Database error")
        })?;

        if exists.is_some() {
            return Err(Status::already_exists("Key already exists and is not revoked"));
        }

        let expires_at = Utc::now() + ChronoDuration::days(30);

        sqlx::query!(
            r#"
            INSERT INTO user_keys (user_id, public_key, fingerprint, expires_at)
            VALUES ($1, $2, $3, $4)
            "#,
            user_id,
            keypair.public_key,
            keypair.fingerprint,
            expires_at.naive_utc()
        )
        .execute(&self.db)
        .await
        .map_err(|e| {
            error!("Database error: {:?}", e);
            Status::internal("Database error")
        })?;

        self.save_private_key(&keypair.private_key).map_err(|e| {
            error!("Failed to save private key: {:?}", e);
            Status::internal("Failed to save private key")
        })?;

        Ok(keypair)
    }

    // Получение приватного ключа
    pub async fn get_private_key(&self) -> Result<RsaPrivateKey, Status> {
        let private_key_pem = self.load_private_key().map_err(|e| {
            error!("Failed to load private key: {:?}", e);
            Status::internal("Failed to load private key")
        })?;

        RsaPrivateKey::from_pkcs8_pem(&private_key_pem)
            .map_err(|e| {
                error!("Failed to parse private key: {:?}", e);
                Status::internal("Invalid private key format")
            })
    }

    pub async fn generate_government_key(&self) -> Result<(), Status> {
        let keypair = Self::generate_keypair().map_err(|e| {
            error!("Government key generation error: {:?}", e);
            Status::internal("Government key generation error")
        })?;

        let valid_from = Utc::now();
        let valid_to = valid_from + ChronoDuration::days(1);

        sqlx::query!(
            "UPDATE government_keys SET is_active = false WHERE is_active = true"
        )
        .execute(&self.db)
        .await
        .map_err(|e| {
            error!("Database error: {:?}", e);
            Status::internal("Database error")
        })?;

        sqlx::query!(
            r#"
            INSERT INTO government_keys 
            (public_key, private_key_encrypted, valid_from, valid_to, is_active)
            VALUES ($1, $2, $3, $4, true)
            "#,
            keypair.public_key,
            keypair.private_key.to_string(),
            valid_from.naive_utc(),
            valid_to.naive_utc()
        )
        .execute(&self.db)
        .await
        .map_err(|e| {
            error!("Database error: {:?}", e);
            Status::internal("Database error")
        })?;

        Ok(())
    }

    pub async fn encrypt_with_government_key(&self, message: &str) -> Result<(String, String), Status> {
        let active_key = sqlx::query!(
            "SELECT public_key FROM government_keys WHERE is_active = true LIMIT 1"
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| {
            error!("Database error: {:?}", e);
            Status::internal("Database error")
        })?
        .ok_or(Status::internal("No active government key found"))?;

        let public_key = RsaPublicKey::from_public_key_pem(&active_key.public_key)
            .map_err(|e| {
                error!("Failed to parse government public key: {:?}", e);
                Status::internal("Invalid government key format")
            })?;

        let mut rng = OsRng;
        let encrypted = public_key.encrypt(
            &mut rng, 
            rsa::Pkcs1v15Encrypt,
            message.as_bytes()
        )
        .map_err(|e| {
            error!("Encryption failed: {:?}", e);
            Status::internal("Encryption failed")
        })?;

        let iv: [u8; 16] = rand::random();
        Ok((hex::encode(encrypted), hex::encode(iv)))
    }

    // Восстановление сообщений по приватному ключу
    pub async fn recover_messages(
        &self,
        user_id: Uuid,
        private_key_pem: &str,
    ) -> Result<Vec<(String, String)>, Status> {
        let fingerprint = Self::generate_fingerprint_from_private(private_key_pem)
            .map_err(|e| {
                error!("Fingerprint error: {:?}", e);
                Status::invalid_argument("Invalid private key")
            })?;

        let key_exists: bool = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM user_keys WHERE user_id = $1 AND fingerprint = $2)",
            user_id,
            fingerprint
        )
        .fetch_one(&self.db)
        .await
        .map_err(|e| {
            error!("Database error: {:?}", e);
            Status::internal("Database error")
        })?.expect("Erorr db");

        if !key_exists {
            return Err(Status::permission_denied("Private key does not belong to user"));
        }

        let messages = sqlx::query!(
            r#"
            SELECT m.id, m.encrypted_content 
            FROM messages m
            JOIN direct_chats_members dcm ON m.chat_id = dcm.chat_id
            WHERE dcm.user_id = $1
            "#,
            user_id
        )
        .fetch_all(&self.db)
        .await
        .map_err(|e| {
            error!("Database error: {:?}", e);
            Status::internal("Database error")
        })?;

        let mut result = Vec::new();
        for message in messages {
            result.push((message.id.to_string(), message.encrypted_content));
        }

        Ok(result)
    }

    fn generate_fingerprint_from_private(private_key_pem: &str) -> Result<String, Box<dyn std::error::Error>> {
        let private_key = RsaPrivateKey::from_pkcs8_pem(private_key_pem)?;
        let public_key = RsaPublicKey::from(&private_key);
        let public_pem = public_key.to_public_key_pem(LineEnding::LF)?;
        Self::generate_fingerprint(&public_pem)
    }
}