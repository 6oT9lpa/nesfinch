use tonic::Status;
use rsa::{RsaPrivateKey, RsaPublicKey, pkcs8::{EncodePrivateKey, EncodePublicKey}};
use rand::rngs::OsRng;
use rsa::pkcs8::LineEnding;
use sha2::{Digest, Sha256};
use chrono::{Utc, Duration as ChronoDuration};
use sqlx::PgPool;

pub struct KeyPair {
    private_key: String, // хранение локально
    public_key: String,
    fingerprint: String,
}

// Генерация RSA ключевой пары
fn generate_keypair(bits: usize) -> Result<KeyPair, Box<dyn std::error::Error>> {
    let mut rng = OsRng;

    let private_key = RsaPrivateKey::new(&mut rng, bits)
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    let public_key = RsaPublicKey::from(&private_key);

    let private_pem = private_key.to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
    let public_pem = public_key.to_public_key_pem(LineEnding::LF)
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    let fingerprint = generate_fingerprint(&public_pem)?;

    Ok(KeyPair { private_key: private_pem.to_string(), public_key: public_pem.to_string(), fingerprint: fingerprint })
}

// Генерация отпечатка публичного ключа
fn generate_fingerprint(public_key: &str) -> Result<String, Box<dyn std::error::Error>> {
    let mut hasher = Sha256::new();
    hasher.update(public_key.as_bytes());
    let result = hasher.finalize();
    
    Ok(hex::encode(result))
}

pub struct KeyManager {
    db: PgPool,
}

impl KeyManager {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    // Генерация пары ключей для нового юзера
    pub async fn generate_user_keys (
        &self,
        user_id: i64,
    ) -> Result<KeyPair, Status> {
        let keypair = generate_keypair(2048)
        .map_err(|e| {
            println!("Password verification error: {:?}", e);
            Status::internal("Hash error")
        })?;

        let exists: Option<i64> = sqlx::query_scalar!(
            "SELECT id FROM user_keys WHERE fingerprint = $1 AND is_revoked = false",
            keypair.fingerprint
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| {
            println!("Database error: {:?}", e);
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
            println!("Database error: {:?}", e);
            Status::internal("Database error")
        })?;

        Ok(keypair)
    }
}