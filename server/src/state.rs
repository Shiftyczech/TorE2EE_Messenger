use crate::config::Config;
use crate::db::QueuedMessage;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

pub type Tx = mpsc::UnboundedSender<QueuedMessage>;
pub type Rx = mpsc::UnboundedReceiver<QueuedMessage>;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: SqlitePool,
    pub active_peers: Arc<RwLock<HashMap<String, Vec<Tx>>>>,
}

impl AppState {
    pub fn new(config: Config, db: SqlitePool) -> Self {
        Self {
            config: Arc::new(config),
            db,
            active_peers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Registers a peer's channel for real-time delivery
    pub async fn subscribe_peer(&self, recipient_pubkey_hash: &str, tx: Tx) {
        let mut peers = self.active_peers.write().await;
        peers
            .entry(recipient_pubkey_hash.to_string())
            .or_default()
            .push(tx);
    }

    /// Dispatches a message to all active WebSocket listeners of this recipient.
    /// Returns true if at least one live listener received the message.
    pub async fn dispatch_live(&self, msg: &QueuedMessage) -> bool {
        let mut peers = self.active_peers.write().await;
        if let Some(senders) = peers.get_mut(&msg.recipient_pubkey_hash) {
            // Retain only live channels
            senders.retain(|tx| tx.send(msg.clone()).is_ok());
            let has_active = !senders.is_empty();
            if !has_active {
                peers.remove(&msg.recipient_pubkey_hash);
            }
            has_active
        } else {
            false
        }
    }
}
