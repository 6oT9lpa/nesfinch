use tonic::{Request, Response, Status};
use serde::Serialize;
use sqlx::PgPool;
use chrono::Utc;
use bcrypt::verify;
use jsonwebtoken::{encode, Header, EncodingKey};

use crate::services::key_manager::KeyManager;

mod auth {
    tonic::include_proto!("auth");
}

pub use auth::auth_service_server::{AuthService, AuthServiceServer};
use auth::{SignInUserInput, SignInUserResponse, SignUpUserInput, SignUpUserResponse, User};

#[derive(Debug)]
pub struct MyAuthService {
    db: PgPool,
    jwt_secret: String,
}

#[derive(Serialize)]
struct Claims {
    sub: String,
    exp: usize,
}

// Генерация JWT токенов аутентификации 
fn create_jwt(sub: &str, secret: &str, expiration: i64) -> Result<String, Status> {
    let claims = Claims {
        sub: sub.to_string(),
        exp: (Utc::now().timestamp() + expiration) as usize,
    };

    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .map_err(|_| Status::internal("JWT encoding error"))
}

impl MyAuthService {
    pub fn new(db: PgPool, jwt_secret: String) -> Self {
        Self { db, jwt_secret }
    }
}

#[tonic::async_trait]
impl AuthService for MyAuthService {

    // регистрация нового пользователя
    async fn sign_up_user(
        &self,
        request: Request<SignUpUserInput>,
    ) -> Result<Response<SignUpUserResponse>, Status> {
        let req = request.into_inner();

        println!("SignUp request: username={}, phone={}, email={}, pasw={}", req.username, req.phone, req.email, req.pasw);

        if req.username.is_empty() || req.phone.is_empty() || req.pasw.is_empty() {
            return Err(Status::invalid_argument("Missing required fields"));
        }

        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE phone_hash = $1"
        )
        .bind(&req.phone)
        .fetch_one(&self.db)
        .await
        .map_err(|_| Status::internal("Database error"))?;

        if exists > 0 {
            return Err(Status::already_exists("User already exists"));
        }

        let now = Utc::now().naive_utc();

        let record = sqlx::query!(
            "INSERT INTO users (username, phone_hash, email, pasw_hash, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, username, email, created_at, updated_at",
            req.username,
            req.phone,
            req.email,
            req.pasw,
            now,
            now,
        )
        .fetch_one(&self.db)
        .await
        .map_err(|_| Status::internal("Insert failed"))?;

        let key_manager = KeyManager::new(self.db.clone());
        let keypair = key_manager.generate_user_keys(record.id).await.map_err(|e| {
            println!("Error generating user keys: {:?}", e);
            Status::internal("Key generation error")
        })?;

        let user = Some(User {
            id: record.id,
            username: record.username,
            email: record.email,
            status: "online".to_string(),
            activity_user: "".to_string(),
            last_seen_at: None,
            created_at: Some(prost_types::Timestamp {
                seconds: record.created_at.and_utc().timestamp(),
                nanos: record.created_at.and_utc().timestamp_subsec_nanos() as i32,
            }),
            update_at: Some(prost_types::Timestamp {
                seconds: record.updated_at.expect("update_at missing").and_utc().timestamp(),
                nanos: record.updated_at.expect("update_at missing").and_utc().timestamp_subsec_nanos() as i32,
            }),                     
        });

        Ok(Response::new(SignUpUserResponse { user }))
    }
    

    // Логирование пользователя
    async fn sign_in_user(
        &self,
        request: Request<SignInUserInput>,
    ) -> Result<Response<SignInUserResponse>, Status> {
        let req = request.into_inner();
        
        println!("SignIn attempt with phone_hash: {}", req.phone);
    
        let record = sqlx::query!(
            "SELECT id, pasw_hash FROM users WHERE phone_hash = $1",
            req.phone
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| {
            println!("Database error: {:?}", e);
            Status::internal("Database error")
        })?;
    
        let Some(user) = record else {
            println!("User not found with phone_hash: {}", req.phone);
            return Err(Status::not_found("User not found"));
        };
    
        println!("User found - ID: {}", user.id);
        let password_valid = verify(&req.password, &user.pasw_hash)
            .map_err(|e| {
                println!("Password verification error: {:?}", e);
                Status::internal("Hash error")
            })?;
    
        if !password_valid {
            println!("Invalid password for user ID: {}", user.id);
            return Err(Status::unauthenticated("Invalid password"));
        }
    
        println!("Generating tokens for user ID: {}", user.id);
        let access_token = create_jwt(&user.id.to_string(), &self.jwt_secret, 3600)?; // 1 hour
        let refresh_token = create_jwt(&user.id.to_string(), &self.jwt_secret, 7 * 24 * 3600)?; // 7 days
    
        Ok(Response::new(SignInUserResponse {
            status: "Success".into(),
            access_token,
            refresh_token,
        }))
    }

    async fn refresh_token(
        &self,
        request: Request<auth::RefreshTokenInput>,
    ) -> Result<Response<auth::RefreshTokenResponse>, Status> {
        let refresh_token = &request.into_inner().refresh_token;
        let new_access = create_jwt(refresh_token, &self.jwt_secret, 3600)?;
        let new_refresh = create_jwt(refresh_token, &self.jwt_secret, 7 * 24 * 3600)?;

        Ok(Response::new(auth::RefreshTokenResponse {
            access_token: new_access,
            refresh_token: new_refresh,
        }))
    }

    async fn get_me(
        &self,
        _request: Request<auth::GetMeInput>,
    ) -> Result<Response<auth::UserResponse>, Status> {
        Ok(Response::new(auth::UserResponse {
            user: None,
        }))
    }
}