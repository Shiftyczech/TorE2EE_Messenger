use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::db::{enqueue_message, QueuedMessage};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub recipient_pubkey_hash: String,
    pub encrypted_payload: String,
    pub nonce: String,
}

#[derive(Debug, Serialize)]
pub struct SendMessageResponse {
    pub status: String,
    pub delivered_live: bool,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

pub async fn handle_send_message(
    State(state): State<AppState>,
    Json(payload): Json<SendMessageRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    // 1. Validate recipient_pubkey_hash (must be 64-char hex SHA256)
    if payload.recipient_pubkey_hash.len() != 64
        || !payload.recipient_pubkey_hash.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid recipient_pubkey_hash: must be 64-char hex SHA256".to_string(),
            }),
        ));
    }

    // 2. Validate payload size
    if payload.encrypted_payload.is_empty()
        || payload.encrypted_payload.len() > state.config.max_payload_bytes
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!(
                    "Payload size exceeds maximum allowed of {} bytes",
                    state.config.max_payload_bytes
                ),
            }),
        ));
    }

    if payload.nonce.is_empty() || payload.nonce.len() > 256 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid nonce length".to_string(),
            }),
        ));
    }

    let now = Utc::now().timestamp();
    let queued_msg = QueuedMessage {
        id: 0,
        recipient_pubkey_hash: payload.recipient_pubkey_hash.clone(),
        encrypted_payload: payload.encrypted_payload.clone(),
        nonce: payload.nonce.clone(),
        created_at: now,
        expires_at: now + state.config.ttl_seconds,
    };

    // 3. Check if recipient is connected via WebSocket right now
    let delivered_live = state.dispatch_live(&queued_msg).await;

    if !delivered_live {
        // Enqueue to SQLite for asynchronous pick-up
        if let Err(e) = enqueue_message(
            &state.db,
            &payload.recipient_pubkey_hash,
            &payload.encrypted_payload,
            &payload.nonce,
            state.config.ttl_seconds,
        )
        .await
        {
            tracing::error!("Database enqueue error: {:?}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to queue message".to_string(),
                }),
            ));
        }
    }

    Ok((
        StatusCode::OK,
        Json(SendMessageResponse {
            status: "accepted".to_string(),
            delivered_live,
        }),
    ))
}
