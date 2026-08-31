import { IdentityManager } from './identity/IdentityManager';
import { TorHttpClient } from './network/TorHttpClient';
import { TorWebSocketClient } from './network/TorWebSocketClient';
import { TorConfig, WsClientState } from './network/types';

async function runCrossIntegrationTest() {
  console.log('========================================================');
  console.log(' TorE2EE Cross-Integration: TS Client -> Rust Backend ');
  console.log('========================================================\n');

  const config: TorConfig = {
    socksProxyHost: '127.0.0.1',
    socksProxyPort: 9050,
    targetHost: '127.0.0.1',
    targetPort: 8080,
    devMode: true, // Connect directly to local Rust relay
  };

  const httpClient = new TorHttpClient(config);

  // 1. Health check
  console.log('[Step 1] Verifying Rust backend health...');
  const isHealthy = await httpClient.checkHealth();
  if (!isHealthy) {
    throw new Error('Rust server is not responding at http://127.0.0.1:8080/health');
  }
  console.log('  -> Rust server is ONLINE and healthy.\n');

  // 2. Generate TypeScript Identities (Alice & Bob)
  console.log('[Step 2] Generating Alice and Bob identities with IdentityManager...');
  const alice = await IdentityManager.generateIdentity();
  const bob = await IdentityManager.generateIdentity();
  console.log(`  -> Alice Pubkey Hash: ${alice.recipientPubkeyHash}`);
  console.log(`  -> Bob Mailbox Hash:  ${bob.recipientPubkeyHash}\n`);

  // 3. Alice sends an offline encrypted envelope to Bob's mailbox
  console.log('[Step 3] Alice sends message to Bob (Offline Blind Drop)...');
  const sendResult = await httpClient.sendMessage({
    recipient_pubkey_hash: bob.recipientPubkeyHash,
    encrypted_payload: 'TS_CLIENT_ENCRYPTED_PAYLOAD_TEST_123',
    nonce: 'TS_NONCE_001',
  });
  console.log(`  -> Server response: status='${sendResult.status}', delivered_live=${sendResult.delivered_live}`);
  if (sendResult.delivered_live) {
    throw new Error('Expected delivered_live=false for offline Bob');
  }
  console.log('  -> Message queued in Rust SQLite storage.\n');

  // 4. Bob connects via TorWebSocketClient, completes Challenge-Response with Rust server and downloads message
  console.log('[Step 4] Bob connects via TorWebSocketClient to Rust Relay stream...');
  await new Promise<void>((resolve, reject) => {
    let wsClient: TorWebSocketClient;

    const timeout = setTimeout(() => {
      wsClient?.disconnect();
      reject(new Error('Cross-integration test timed out waiting for message'));
    }, 10000);

    wsClient = new TorWebSocketClient(config, bob, {
      onStateChange: (state) => {
        console.log(`  -> WS State changed: ${state}`);
      },
      onAuthenticated: (pubkeyHash) => {
        console.log(`  -> Successfully authenticated with Rust server! Mailbox: ${pubkeyHash}`);
      },
      onMessage: (msg) => {
        console.log(`  -> Received Message from Rust Server:`);
        console.log(`     Payload: '${msg.encrypted_payload}'`);
        console.log(`     Nonce:   '${msg.nonce}'`);
        console.log(`     Created: ${new Date(msg.created_at * 1000).toISOString()}`);

        if (msg.encrypted_payload !== 'TS_CLIENT_ENCRYPTED_PAYLOAD_TEST_123') {
          clearTimeout(timeout);
          wsClient.disconnect();
          reject(new Error(`Payload mismatch: got ${msg.encrypted_payload}`));
          return;
        }

        clearTimeout(timeout);
        wsClient.disconnect();
        console.log('  -> Clean disconnection complete.\n');
        resolve();
      },
      onError: (err) => {
        clearTimeout(timeout);
        wsClient.disconnect();
        reject(err);
      },
    });

    wsClient.connect();
  });

  console.log('========================================================');
  console.log(' CROSS-INTEGRATION TEST PASSED (TypeScript <-> Rust) ');
  console.log('========================================================\n');
}

runCrossIntegrationTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

