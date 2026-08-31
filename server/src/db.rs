use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, FromRow, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct QueuedMessage {
    pub id: i64,
    pub recipient_pubkey_hash: String,
    pub encrypted_payload: String,
    pub nonce: String,
    pub created_at: i64,
    pub expires_at: i64,
}

pub async fn init_db(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_pubkey_hash TEXT NOT NULL,
            encrypted_payload TEXT NOT NULL,
            nonce TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_pubkey_hash);
        CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at);
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}

pub async fn enqueue_message(
    pool: &SqlitePool,
    recipient_pubkey_hash: &str,
    encrypted_payload: &str,
    nonce: &str,
    ttl_seconds: i64,
) -> Result<i64, sqlx::Error> {
    let now = Utc::now().timestamp();
    let expires_at = now + ttl_seconds;

    let res = sqlx::query(
        r#"
        INSERT INTO messages (recipient_pubkey_hash, encrypted_payload, nonce, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(recipient_pubkey_hash)
    .bind(encrypted_payload)
    .bind(nonce)
    .bind(now)
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(res.last_insert_rowid())
}

/// Fetches all queued messages for a recipient and immediately deletes them in an atomic transaction.
/// Zero-Knowledge principle: server does not retain delivered messages.
pub async fn fetch_and_delete_messages(
    pool: &SqlitePool,
    recipient_pubkey_hash: &str,
) -> Result<Vec<QueuedMessage>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let messages = sqlx::query_as::<_, QueuedMessage>(
        r#"
        SELECT id, recipient_pubkey_hash, encrypted_payload, nonce, created_at, expires_at
        FROM messages
        WHERE recipient_pubkey_hash = ?
        ORDER BY id ASC
        "#,
    )
    .bind(recipient_pubkey_hash)
    .fetch_all(&mut *tx)
    .await?;

    if !messages.is_empty() {
        sqlx::query(
            r#"
            DELETE FROM messages
            WHERE recipient_pubkey_hash = ?
            "#,
        )
        .bind(recipient_pubkey_hash)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(messages)
}

/// Deletes all messages whose TTL has expired.
pub async fn cleanup_expired_messages(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let now = Utc::now().timestamp();
    let res = sqlx::query(
        r#"
        DELETE FROM messages
        WHERE expires_at <= ?
        "#,
    )
    .bind(now)
    .execute(pool)
    .await?;

    Ok(res.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_enqueue_and_fetch_deletes() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let recipient = "deadbeef1234";

        let id = enqueue_message(&pool, recipient, "enc_blob_1", "nonce1", 3600)
            .await
            .unwrap();
        assert!(id > 0);

        let messages = fetch_and_delete_messages(&pool, recipient).await.unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].encrypted_payload, "enc_blob_1");

        // Second fetch should be completely empty
        let empty = fetch_and_delete_messages(&pool, recipient).await.unwrap();
        assert_eq!(empty.len(), 0);
    }

    #[tokio::test]
    async fn test_ttl_cleanup() {
        let pool = init_db("sqlite::memory:").await.unwrap();
        let recipient = "deadbeef5678";

        // Insert message with TTL -10 (already expired)
        enqueue_message(&pool, recipient, "expired_blob", "nonce2", -10)
            .await
            .unwrap();

        // Insert message with TTL +3600 (valid)
        enqueue_message(&pool, recipient, "valid_blob", "nonce3", 3600)
            .await
            .unwrap();

        let deleted = cleanup_expired_messages(&pool).await.unwrap();
        assert_eq!(deleted, 1);

        let messages = fetch_and_delete_messages(&pool, recipient).await.unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].encrypted_payload, "valid_blob");
    }
}
