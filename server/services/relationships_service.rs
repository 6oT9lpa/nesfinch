use tonic::{Request, Response, Status};
use sqlx::PgPool;
use chrono::Utc;
use uuid::Uuid;

mod communication {
    tonic::include_proto!("communication"); 
}

pub use communication::relationship_service_server::{ RelationshipService, RelationshipServiceServer };
use communication::{UpdateRelationshipRequest, UpdateRelationshipResponse, CreateRelationshipRequest, CreateRelationshipResponse,
    GetRelationshipsRequest, GetRelationshipsResponse, GetRelationshipStatusRequest, GetRelationshipStatusResponse,
    CancelRelationshipRequest, CancelRelationshipResponse};

#[derive(Debug)]
pub struct MyRelationshipService {
    db: PgPool,
}

#[derive(Debug, sqlx::FromRow)]
struct RelationshipRow {
    id: Uuid,
    username: String,
    display_name: String,
    status: String,
    updated_at: chrono::NaiveDateTime,
    is_initiator: bool,
}

impl MyRelationshipService {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
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
            success: true,
        }))
    }

    async fn get_relationships(
        &self,
        request: Request<GetRelationshipsRequest>,
    ) -> Result<Response<GetRelationshipsResponse>, Status> {
        let req = request.into_inner();

        let current_user = Uuid::parse_str(&req.current_user)
            .map_err(|_| Status::invalid_argument("Invalid current_user UUID"))?;

        let rel_type_str = match req.new_type {
            1 => "FRIEND",
            2 => "BLOCKED",
            3 => "PENDING",
            _ => return Err(Status::invalid_argument("Invalid relationship type")),
        };

        let query = match rel_type_str {
            "PENDING" => {
                sqlx::query_as::<_, RelationshipRow>(
                    r#"
                    SELECT 
                        u.id, 
                        u.username, 
                        u.display_name, 
                        'PENDING' as status, 
                        rr.created_at as updated_at,
                        false as is_initiator
                    FROM relationship_requests rr
                    JOIN users u ON rr.from_user_id = u.id
                    WHERE rr.to_user_id = $1 AND rr.status = 'PENDING'
                    UNION ALL
                    SELECT 
                        u.id, 
                        u.username, 
                        u.display_name, 
                        'PENDING' as status, 
                        rr.created_at as updated_at,
                        true as is_initiator
                    FROM relationship_requests rr
                    JOIN users u ON rr.to_user_id = u.id
                    WHERE rr.from_user_id = $1 AND rr.status = 'PENDING'
                    ORDER BY updated_at DESC
                    LIMIT $2 OFFSET $3
                    "#
                )
                .bind(current_user)
                .bind(req.limit as i64)
                .bind(req.offset as i64)
            },
            _ => {
                sqlx::query_as::<_, RelationshipRow>(
                    r#"
                    SELECT 
                        u.id, 
                        u.username, 
                        u.display_name, 
                        ur.status, 
                        ur.updated_at,
                        (ur.user_id = $1) as is_initiator
                    FROM user_relationships ur
                    JOIN users u ON 
                        (ur.user_id = $1 AND ur.target_user_id = u.id) OR
                        (ur.target_user_id = $1 AND ur.user_id = u.id)
                    WHERE ur.status = $2
                    ORDER BY ur.updated_at DESC
                    LIMIT $3 OFFSET $4
                    "#
                )
                .bind(current_user)
                .bind(rel_type_str)
                .bind(req.limit as i64)
                .bind(req.offset as i64)
            }
        };

        let rows = query
            .fetch_all(&self.db)
            .await
            .map_err(|e| Status::internal(format!("DB fetch error: {}", e)))?;

        print!("Rows: {:?}", rows);

        let mut users = Vec::new();
        let mut types = Vec::new();
        let mut statuses = Vec::new();
        let mut initiator_statuses = Vec::new(); 

        for row in rows {
            users.push(communication::User {
                id: row.id.to_string(),
                username: row.username,
                display_name: row.display_name,
                status: row.status,
                created_at: Some(prost_types::Timestamp {
                    seconds: row.updated_at.and_utc().timestamp(),
                    nanos: row.updated_at.and_utc().timestamp_subsec_nanos() as i32,
                }),
            });

            types.push(req.new_type);
            statuses.push(if row.is_initiator { 1 } else { 3 }); 
            initiator_statuses.push(if row.is_initiator { "INITIATOR".to_string() } else { "RECIPIENT".to_string() });
        }

        let count = users.len() as i32;

        Ok(Response::new(GetRelationshipsResponse {
            users,
            types,
            statuses,
            initiator_statuses, 
            total_count: count,
        }))
    }
    async fn get_relationship_status(
        &self,
        request: Request<GetRelationshipStatusRequest>,
    ) -> Result<Response<GetRelationshipStatusResponse>, Status> {
        let req = request.into_inner();

        let current_user = Uuid::parse_str(&req.current_user)
            .map_err(|_| Status::invalid_argument("Invalid target_user_id UUID"))?;

        let target_user = Uuid::parse_str(&req.target_user)
            .map_err(|_| Status::invalid_argument("Invalid target_user_id UUID"))?;

        let row = sqlx::query!(
            r#"
            SELECT status, updated_at
            FROM user_relationships
            WHERE user_id = $1 AND target_user_id = $2
            "#,
            current_user,
            target_user
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        if let Some(r) = row {
            let _rel_type = match r.status.as_str() {
                "FRIEND" => 1,
                "BLOCKED" => 2,
                "PENDING" => 3,
                _ => 0,
            };

            return Ok(Response::new(GetRelationshipStatusResponse { 
                success: true,
                updated_at: Some(prost_types::Timestamp {
                    seconds: r.updated_at.and_utc().timestamp(),
                    nanos: r.updated_at.and_utc().timestamp_subsec_nanos() as i32,
                }),
            }));
        }

        Ok(Response::new(GetRelationshipStatusResponse {
            success: false,
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
                seconds: created_at.and_utc().timestamp(),
                nanos: created_at.and_utc().timestamp_subsec_nanos() as i32,
            }),
        }))
    }

    async fn cancel_relationship(
        &self,
        request: Request<CancelRelationshipRequest>
    ) -> Result<Response<CancelRelationshipResponse>, Status> {
        let req = request.into_inner();

        let from_user = Uuid::parse_str(&req.current_user)
        .map_err(|_| Status::invalid_argument("Invalid current_user UUID"))?;

        let to_user = Uuid::parse_str(&req.target_user)
            .map_err(|_| Status::invalid_argument("Invalid target_user UUID"))?;

        let result = sqlx::query!(
            r#"
            DELETE FROM relationship_requests
            WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'PENDING'
            "#,
            from_user,
            to_user
        )
        .execute(&self.db)
        .await
        .map_err(|e| Status::internal(format!("DB error: {}", e)))?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("No pending request found to cancel"));
        }

        Ok(Response::new(CancelRelationshipResponse {
            success: true,
        }))
    }
}