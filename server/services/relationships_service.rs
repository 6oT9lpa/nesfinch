use tonic::{Request, Response, Status};
use serde::Serialize;
use sqlx::PgPool;
use chrono::Utc;
use uuid::Uuid;

mod communication {
    tonic::include_proto!("communication"); 
}

pub use communication::relationship_service_server::{ RelationshipService, RelationshipServiceServer };
use communication::{UpdateRelationshipRequest, UpdateRelationshipResponse, CreateRelationshipRequest, CreateRelationshipResponse,
    GetRelationshipsRequest, GetRelationshipsResponse, GetRelationshipStatusRequest, GetRelationshipStatusResponse};

#[derive(Debug)]
pub struct MyRelationshipService {
    db: PgPool,
}

#[tonic::async_trait]
impl RelationshipService for MyRelationshipService {
    async fn update_relationship(
        &self,
        request: Request<UpdateRelationshipRequest>,
    ) -> Result<Response<UpdateRelationshipResponse>, Status> {
        let req = request.into_inner();

        let new_status = match req.new_status {
            1 => "ACCEPTED",
            2 => "REJECTED",
            3 => "PENDING",
            _ => return Err(Status::invalid_argument("Invalid status")),
        };

        let new_type = match req.new_type {
            1 => "FRIEND",
            2 => "BLOCKED",
            3 => "PENDING",
            _ => return Err(Status::invalid_argument("Invalid relationship type")),
        };

        let user_id = Uuid::parse_str(&req.current_user)
            .map_err(|_| Status::invalid_argument("Invalid current_user UUID"))?;
        let target_user_id = Uuid::parse_str(&req.target_user)
            .map_err(|_| Status::invalid_argument("Invalid target_user UUID"))?;

        let updated_at = Utc::now().naive_utc();

        let mut tx = self.db.begin().await.map_err(|e| {
            Status::internal(format!("Failed to begin transaction: {}", e))
        })?;

        sqlx::query!(
            r#"
            INSERT INTO user_relationships (user_id, target_user_id, status, updated_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, target_user_id)
            DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
            "#,
            user_id,
            target_user_id,
            new_type,
            updated_at
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| Status::internal(format!("Database update error: {}", e)))?;

        sqlx::query!(
            r#"
            UPDATE relationship_requests
            SET status = $1, updated_at = $2
            WHERE (from_user_id = $3 AND to_user_id = $4)
            OR (from_user_id = $4 AND to_user_id = $3)
            "#,
            new_status,
            updated_at,
            user_id,
            target_user_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| Status::internal(format!("Failed to update relationship request: {}", e)))?;

        tx.commit().await.map_err(|e| {
            Status::internal(format!("Transaction commit failed: {}", e))
        })?;

        Ok(Response::new(UpdateRelationshipResponse {
            current_type: req.new_type,
            current_status: req.new_status,
            updated_at: Some(prost_types::Timestamp {
                seconds: updated_at.timestamp(),
                nanos: updated_at.timestamp_subsec_nanos() as i32,
            }),
        }))
    }

    async fn get_relationships(
        &self,
        request: Request<GetRelationshipsRequest>,
    ) -> Result<Response<GetRelationshipsResponse>, Status> {
        let req = request.into_inner();

        let rel_type_str = match req.new_type {
            1 => "FRIEND",
            2 => "BLOCKED",
            3 => "PENDING",
            _ => return Err(Status::invalid_argument("Invalid relationship type")),
        };

        let rows = sqlx::query!(
            r#"
            SELECT u.id, u.username, ur.status, ur.updated_at
            FROM user_relationships ur
            JOIN users u ON ur.target_user_id = u.id
            WHERE ur.status = $1
            ORDER BY ur.updated_at DESC
            LIMIT $2 OFFSET $3
            "#,
            rel_type_str,
            req.limit as i64,
            
            req.offset as i64
        )
        .fetch_all(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB fetch error: {}", e)))?;

        let mut users = Vec::new();
        let mut types = Vec::new();
        let mut statuses = Vec::new();

        for row in rows {
            users.push(communication::User {
                id: row.id.to_string(),
                username: row.username,
                status: row.status.clone(),
                created_at: Some(prost_types::Timestamp {
                    seconds: row.updated_at.timestamp(),
                    nanos: row.updated_at.timestamp_subsec_nanos() as i32,
                }),
            });

            types.push(req.new_type);
            statuses.push(1); 
        }

        let count = users.len() as i32;

        Ok(Response::new(GetRelationshipsResponse {
            users,
            types,
            statuses,
            total_count: count,
        }))
    }


    async fn get_relationship_status(
        &self,
        request: Request<GetRelationshipStatusRequest>,
    ) -> Result<Response<GetRelationshipStatusResponse>, Status> {
        let req = request.into_inner();

        let target_id = Uuid::parse_str(&req.target_user_id)
            .map_err(|_| Status::invalid_argument("Invalid target_user_id UUID"))?;

        let row = sqlx::query!(
            r#"
            SELECT status, updated_at
            FROM user_relationships
            WHERE target_user_id = $1
            "#,
            target_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        if let Some(r) = row {
            let rel_type = match r.status.as_str() {
                "FRIEND" => 1,
                "BLOCKED" => 2,
                "PENDING" => 3,
                _ => 0,
            };

            return Ok(Response::new(GetRelationshipStatusResponse {
                relationship_type: rel_type,
                status: 1, 
                updated_at: Some(prost_types::Timestamp {
                    seconds: r.updated_at.timestamp(),
                    nanos: r.updated_at.timestamp_subsec_nanos() as i32,
                }),
            }));
        }

        Ok(Response::new(GetRelationshipStatusResponse {
            relationship_type: 0,
            status: 0,
            updated_at: None,
        }))
    }

    async fn create_relationship(
        &self,
        request: Request<CreateRelationshipRequest>,
    ) -> Result<Response<CreateRelationshipResponse>, Status> {
        let req = request.into_inner();

        let from_user = Uuid::parse_str(&req.current_user)
            .map_err(|_| Status::invalid_argument("Invalid current_user UUID"))?;
        let to_user = Uuid::parse_str(&req.target_user)
            .map_err(|_| Status::invalid_argument("Invalid target_user UUID"))?;

        if from_user == to_user {
            return Err(Status::invalid_argument("Cannot create relationship with self"));
        }

        let created_at = Utc::now().naive_utc();

        let existing = sqlx::query_scalar!(
            r#"
            SELECT status FROM relationship_requests
            WHERE from_user_id = $1 AND to_user_id = $2
            "#,
            from_user,
            to_user
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        if existing.is_some() {
            return Err(Status::already_exists("Relationship request already exists"));
        }

        sqlx::query!(
            r#"
            INSERT INTO relationship_requests (from_user_id, to_user_id, status, created_at, updated_at)
            VALUES ($1, $2, 'PENDING', $3, $3)
            "#,
            from_user,
            to_user,
            created_at
        )
        .execute(&self.db)
        .await
        .map_err(|e| Status::internal(format!("Failed to insert: {}", e)))?;

        Ok(Response::new(CreateRelationshipResponse {
            status: 3,
            created_at: Some(prost_types::Timestamp {
                seconds: created_at.timestamp(),
                nanos: created_at.timestamp_subsec_nanos() as i32,
            }),
        }))
    }
}