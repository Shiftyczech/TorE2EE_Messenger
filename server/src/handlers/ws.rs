use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::timeout;

use crate::auth::{generate_challenge_nonce, verify_challenge_signature};
use crate::db::{fetch_and_delete_messages, QueuedMessage};
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerWsMessage {
    #[serde(rename = "challenge")]
    Challenge { challenge: String },
    #[serde(rename = "authenticated")]
    Authenticated { recipient_pubkey_hash: String },
    #[serde(rename = "message")]
    MessagePayload {
        encrypted_payload: String,
        nonce: String,
        created_at: i64,
    },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientWsMessage {
    #[serde(rename = "auth")]
    Auth {
        public_key: String,
        signature: String,
    },
    #[serde(rename = "ping")]
    Ping,
}

pub async fn handle_ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_session(socket, state))
}

async fn handle_ws_session(mut socket: WebSocket, state: AppState) {
    // 1. Generate challenge nonce
    let challenge_bytes = generate_challenge_nonce();
    let challenge_hex = hex::encode(challenge_bytes);

    let challenge_msg = ServerWsMessage::Challenge {
        challenge: challenge_hex.clone(),
    };

    let serialized = match serde_json::to_string(&challenge_msg) {
        Ok(s) => s,
        Err(_) => return,
    };

    if socket.send(Message::Text(serialized.into())).await.is_err() {
        return;
    }

    // 2. Await Client Auth Response with 10s timeout
    let auth_timeout = Duration::from_secs(10);
    let pubkey_hash = match timeout(auth_timeout, socket.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => {
            match serde_json::from_str::<ClientWsMessage>(&text) {
                Ok(ClientWsMessage::Auth {
                    public_key,
                    signature,
                }) => match verify_challenge_signature(&public_key, &challenge_bytes, &signature) {
                    Ok(hash) => hash,
                    Err(e) => {
                        let err_msg = ServerWsMessage::Error {
                            message: format!("Authentication failed: {e}"),
                        };
                        let _ = socket
                            .send(Message::Text(
                                serde_json::to_string(&err_msg).unwrap_or_default().into(),
                            ))
                            .await;
                        return;
                    }
                },
                _ => {
                    let err_msg = ServerWsMessage::Error {
                        message: "Expected auth message".to_string(),
                    };
                    let _ = socket
                        .send(Message::Text(
                            serde_json::to_string(&err_msg).unwrap_or_default().into(),
                        ))
                        .await;
                    return;
                }
            }
        }
        _ => return, // Timeout or connection dropped
    };

    // 3. Confirm Authentication
    let auth_ok_msg = ServerWsMessage::Authenticated {
        recipient_pubkey_hash: pubkey_hash.clone(),
    };
    if socket
        .send(Message::Text(
            serde_json::to_string(&auth_ok_msg).unwrap_or_default().into(),
        ))
        .await
        .is_err()
    {
        return;
    }

    // 4. Fetch and immediately delete all queued messages (Blind Drop Delivery)
    if let Ok(queued_messages) = fetch_and_delete_messages(&state.db, &pubkey_hash).await {
        for msg in queued_messages {
            let outgoing = ServerWsMessage::MessagePayload {
                encrypted_payload: msg.encrypted_payload,
                nonce: msg.nonce,
                created_at: msg.created_at,
            };
            if let Ok(text) = serde_json::to_string(&outgoing) {
                if socket.send(Message::Text(text.into())).await.is_err() {
                    return;
                }
            }
        }
    }

    // 5. Setup live streaming channel
    let (tx, mut rx) = mpsc::unbounded_channel::<QueuedMessage>();
    state.subscribe_peer(&pubkey_hash, tx).await;

    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Task for streaming messages to WebSocket client
    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let outgoing = ServerWsMessage::MessagePayload {
                encrypted_payload: msg.encrypted_payload,
                nonce: msg.nonce,
                created_at: msg.created_at,
            };
            if let Ok(text) = serde_json::to_string(&outgoing) {
                if ws_sender.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Task for reading incoming messages from WebSocket client (pings, keep-alives)
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(client_msg) = serde_json::from_str::<ClientWsMessage>(&text) {
                        match client_msg {
                            ClientWsMessage::Ping => {
                                // Keep-alive handled
                            }
                            _ => {}
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // If either task completes, abort the other
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };

    tracing::debug!("Client disconnected for hash: {}", &pubkey_hash[..8]);
}

