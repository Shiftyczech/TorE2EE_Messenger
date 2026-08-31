use std::time::Duration;
use sqlx::SqlitePool;
use tokio::time::interval;

use crate::db::cleanup_expired_messages;

pub fn start_ttl_worker(pool: SqlitePool, cleanup_interval_seconds: u64) {
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(cleanup_interval_seconds));
        loop {
            ticker.tick().await;
            match cleanup_expired_messages(&pool).await {
                Ok(count) => {
                    if count > 0 {
                        tracing::info!("TTL Worker: Cleaned up {} expired message(s)", count);
                    }
                }
                Err(e) => {
                    tracing::error!("TTL Worker error during cleanup: {:?}", e);
                }
            }
        }
    });
}

