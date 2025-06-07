use tonic::{Request, Response, Status};
use sqlx::PgPool;
use uuid::Uuid;
use chrono::{Utc, NaiveDateTime};
use rsa::{RsaPublicKey, pkcs8::DecodePublicKey};
use prost_types::Timestamp;

use crate::services::key_manager::KeyManager;

mod chats {
    tonic::include_proto!("chats"); 
}

pub use chats::chat_service_server::{ChatService, ChatServiceServer};
use chats::*;

#[derive(Debug)]
pub struct MyChatsService {
    db: PgPool
}

impl MyChatsService {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

#[tonic::async_trait]
impl ChatService for MyChatsService {
    async fn create_chat_dm(
        &self,
        request: Request<CreateChatDmRequest>,
    ) -> Result<Response<CreateChatDmResponse>, Status> {
        let req = request.into_inner();

        let current_user = Uuid::parse_str(&req.current_user)
            .map_err(|_| Status::invalid_argument("Invalid current_user UUID"))?;
        let target_user = Uuid::parse_str(&req.target_user)
            .map_err(|_| Status::invalid_argument("Invalid target_user UUID"))?;

        let existing_chat: Option<Uuid> = sqlx::query_scalar!(
            r#"
            SELECT dc.id FROM direct_chats dc
            JOIN direct_chats_members dcm1 ON dc.id = dcm1.chat_id AND dcm1.user_id = $1
            JOIN direct_chats_members dcm2 ON dc.id = dcm2.chat_id AND dcm2.user_id = $2
            WHERE dc.is_group = false
            "#,
            current_user,
            target_user
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        if let Some(chat_id) = existing_chat {
            return Err(Status::already_exists(format!("Chat already exists with id: {}", chat_id)));
        }

        let created_at = Utc::now().naive_utc();
        let record = sqlx::query!(
            r#"
            INSERT INTO direct_chats (is_group, created_at)
            VALUES (false, $1)
            RETURNING id
            "#,
            created_at
        )
        .fetch_one(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        sqlx::query!(
            r#"
            INSERT INTO direct_chats_members (chat_id, user_id)
            VALUES ($1, $2), ($1, $3)
            "#,
            record.id,
            current_user,
            target_user
        )
        .execute(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        let key_manager = KeyManager::new(self.db.clone());

        let current_user_key = key_manager.generate_user_keys(current_user).await?;
        let target_user_key =key_manager.generate_user_keys(target_user).await?;

        let session_key = key_manager.get_encryption_key();
        let encrypted_for_current = key_manager.encrypt_data(&session_key)
            .map_err(|e| Status::internal(format!("Encryption error: {}", e)))?;
        let encrypted_for_target = key_manager.encrypt_data(&session_key)
            .map_err(|e| Status::internal(format!("Encryption error: {}", e)))?;

        sqlx::query!(
            r#"
            INSERT INTO direct_chats_keys (chat_id, user_id, encrypted_key)
            VALUES ($1, $2, $3), ($1, $4, $5)
            "#,
            record.id,
            current_user,
            hex::encode(&encrypted_for_current),
            target_user,
            hex::encode(&encrypted_for_target)
        )
        .execute(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        let response = CreateChatDmResponse {
            chat_id: record.id.to_string(),
            encrypted_key: Some(EncryptedKey { 
                encrypted_data: hex::encode(encrypted_for_current), 
                iv: hex::encode(&session_key[..16]), 
                expires_at: Some(timestamp_from_naive(created_at)),
            }),
        };

        Ok(Response::new(response))
    }

    async fn create_chat_group(
        &self,
        request: Request<CreateChatGroupRequest>,
    ) -> Result<Response<CreateChatGroupResponse>, Status> {
        let req = request.into_inner();

        if req.target_users.len() < 2 {
            return Err(Status::invalid_argument("Group chat requires at least 2 other members"));
        }

        let current_user = Uuid::parse_str(&req.current_user)
            .map_err(|_| Status::invalid_argument("Invalid current_user UUID"))?;

        let mut target_users = Vec::new();
        for user in req.target_users {
            let user_id = Uuid::parse_str(&user)
                .map_err(|_| Status::invalid_argument(format!("Invalid user Uuid: {}", user)))?;
            target_users.push(user_id);
        }

        let created_at = Utc::now().naive_utc();
        let record = sqlx::query!(
            r#"
            INSERT INTO direct_chats (is_group, created_at)
            VALUES (true, $1)
            RETURNING id
            "#,
            created_at
        )
        .fetch_one(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;
        
        let mut members = target_users.clone();
        members.push(current_user);

        for member in &members {
            sqlx::query!(
                r#"
                INSERT INTO direct_chats_members (chat_id, user_id)
                VALUES ($1, $2)
                "#,
                record.id,
                member
            )
            .execute(&self.db)
            .await
            .map_err(|e| Status::internal(format!("DB error: {}", e)))?;
        }

        let key_manager = KeyManager::new(self.db.clone());
        let session_key = key_manager.get_encryption_key();
        let encrypted_session = key_manager.encrypt_data(&session_key)
            .map_err(|e| Status::internal(format!("Encryption error: {}", e)))?;

        for member in &members {
            let user_key = key_manager.generate_user_keys(*member).await?;
            let encrypted_key = key_manager.encrypt_data(&session_key)
                .map_err(|e| Status::internal(format!("Encryption error: {}", e)))?;

            sqlx::query!(
                r#"
                INSERT INTO direct_chats_keys (chat_id, user_id, encrypted_key)
                VALUES ($1, $2, $3)
                "#,
                record.id,
                member, 
                hex::encode(&encrypted_key)
            )
            .execute(&self.db)
            .await
            .map_err(|e| Status::internal(format!("DB error: {}", e)))?;
        }

        let response = CreateChatGroupResponse {
            chat_id: record.id.to_string(),
            session_key: Some(EncryptedKey {
                encrypted_data: hex::encode(encrypted_session),
                iv: hex::encode(&session_key[..16]),
                expires_at: Some(timestamp_from_naive(created_at)),
            }),
        };

        Ok(Response::new(response))
    }

    async fn send_message(
        &self, 
        request: Request<SendMessageRequest>,
    ) -> Result<Response<SendMessageResponse>, Status> {
        let req = request.into_inner();

        let chat_id = Uuid::parse_str(&req.chat_id)
            .map_err(|_| Status::invalid_argument("Invalid chat_id UUID"))?;
        let sender_id = Uuid::parse_str(&req.sender_id)
            .map_err(|_| Status::invalid_argument("Invalid sender_id UUID"))?;

        let is_member: bool = sqlx::query_scalar!(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM direct_chats_members
                WHERE chat_id = $1 AND user_id = $2
            )
            "#,
            chat_id,
            sender_id
        )
        .fetch_one(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?.expect("Error exists db");

        if !is_member {
            return Err(Status::permission_denied("User is not a member of the chat!"));
        }

        let sent_at = Utc::now().naive_utc();
        let record = sqlx::query!(
            r#"
            INSERT INTO messages (chat_id, sender_id, encrypted_content, sent_at)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            "#,
            chat_id,
            sender_id,
            req.encrypted_content,
            sent_at
        )
        .fetch_one(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;
        
        sqlx::query!(
            r#"
            UPDATE direct_chats
            SET last_message = $1
            WHERE id = $2
            "#,
            record.id,
            chat_id
        )
        .execute(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        let response = SendMessageResponse {
            message_id: record.id.to_string(),
            sent_at: Some(timestamp_from_naive(sent_at)),
        };

        Ok(Response::new(response))
    }

    async fn exchange_public_keys(
        &self,
        request: Request<ExchangeKeysRequest>,
    ) -> Result<Response<ExchangeKeysResponse>, Status> {
        let req = request.into_inner();

        let user_id = Uuid::parse_str(&req.user_id)
            .map_err(|_| Status::invalid_argument("Invalid user_id UUID"))?;

        let _ = RsaPublicKey::from_public_key_pem(&req.public_key)
            .map_err(|e| Status::invalid_argument(format!("Invalid public key: {}", e)))?;

        let fingerprint = KeyManager::generate_fingerprint(&req.public_key)
            .map_err(|e| Status::internal(format!("Fingerprint error: {}", e)))?;

        let expires_at = Utc::now() + chrono::Duration::days(30);

        sqlx::query!(
            r#"
            INSERT INTO user_keys (user_id, public_key, fingerprint, expires_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (fingerprint) DO UPDATE
            SET public_key = EXCLUDED.public_key,
                expires_at = EXCLUDED.expires_at,
                is_revoked = false
            "#,
            user_id,
            req.public_key,
            fingerprint,
            expires_at.naive_utc()
        )
        .execute(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        let response = ExchangeKeysResponse {
            target_user_id: user_id.to_string(),
            public_key: req.public_key,
        };

        Ok(Response::new(response))
    }
}

fn timestamp_from_naive(dt: NaiveDateTime) -> Timestamp {
    let utc_dt = chrono::DateTime::<Utc>::from_utc(dt, Utc);
    Timestamp {
        seconds: utc_dt.timestamp(),
        nanos: utc_dt.timestamp_subsec_nanos() as i32,
    }
}