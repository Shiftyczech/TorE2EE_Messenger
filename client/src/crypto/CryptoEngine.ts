import nacl from 'tweetnacl';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { IdentityManager } from '../identity/IdentityManager';
import { Curve25519KeyPair, UserIdentity } from '../identity/types';
import { ISignalStore } from './ISignalStore';
import {
  EncryptedMessage,
  OneTimePreKey,
  PreKeyBundle,
  SessionRecord,
  SignedPreKey,
} from './types';

const MAX_SKIP_MESSAGES = 2000;
const HKDF_INFO_X3DH = new TextEncoder().encode('TorE2EE-X3DH-MasterSecret');
const HKDF_INFO_ROOT = new TextEncoder().encode('TorE2EE-RootKDF');
const HKDF_INFO_CHAIN = new TextEncoder().encode('TorE2EE-ChainKDF');

export class CryptoEngine {
  private store: ISignalStore;

  constructor(store: ISignalStore) {
    this.store = store;
  }

  /**
   * Generates a PreKeyBundle including a Signed PreKey and a batch of One-Time PreKeys.
   */
  public async generatePreKeyBundle(
    oneTimePreKeyCount: number = 50
  ): Promise<PreKeyBundle> {
    const identity = await this.store.getIdentity();

    // 1. Generate Signed PreKey (Curve25519)
    const spkKeyPair = this.generateCurve25519KeyPair();
    const spkId = Math.floor(Math.random() * 0x7fffffff);

    // Sign the Signed PreKey public key with Identity's Ed25519 signing key
    const spkSignatureHex = IdentityManager.signChallenge(
      spkKeyPair.publicKeyHex,
      identity.signingKey.secretKey
    );

    const signedPreKeyRecord: SignedPreKey = {
      keyId: spkId,
      keyPair: spkKeyPair,
      signatureHex: spkSignatureHex,
      createdAt: Date.now(),
    };
    await this.store.saveSignedPreKey(spkId, signedPreKeyRecord);

    // 2. Generate batch of One-Time PreKeys
    let firstOtk: { keyId: number; publicKeyHex: string } | undefined;
    for (let i = 0; i < oneTimePreKeyCount; i++) {
      const otkKeyPair = this.generateCurve25519KeyPair();
      const otkId = Math.floor(Math.random() * 0x7fffffff);
      const otkRecord: OneTimePreKey = {
        keyId: otkId,
        keyPair: otkKeyPair,
      };
      await this.store.saveOneTimePreKey(otkId, otkRecord);
      if (i === 0) {
        firstOtk = { keyId: otkId, publicKeyHex: otkKeyPair.publicKeyHex };
      }
    }

    return {
      identityKeyHex: identity.encryptionKey.publicKeyHex,
      signingKeyHex: identity.signingKey.publicKeyHex,
      signedPreKey: {
        keyId: spkId,
        publicKeyHex: spkKeyPair.publicKeyHex,
        signatureHex: spkSignatureHex,
      },
      oneTimePreKey: firstOtk,
    };
  }

  /**
   * Initiates a new Double Ratchet session with a peer using their PreKeyBundle (X3DH Alice side).
   */
  public async initiateSession(
    recipientIdentityKeyHex: string,
    bundle: PreKeyBundle
  ): Promise<SessionRecord> {
    const identity = await this.store.getIdentity();

    // 1. Verify recipient's Signed PreKey signature
    const isSpkValid = IdentityManager.verifySignature(
      bundle.signedPreKey.publicKeyHex,
      bundle.signedPreKey.signatureHex,
      bundle.signingKeyHex
    );
    if (!isSpkValid) {
      throw new Error("Recipient's Signed PreKey signature verification failed");
    }

    const ikA = identity.encryptionKey;
    const ikB = hexToBytes(bundle.identityKeyHex);
    const spkB = hexToBytes(bundle.signedPreKey.publicKeyHex);

    // Generate Alice's ephemeral keypair (EK_A) which also acts as initial DH ratchet key
    const ekA = this.generateCurve25519KeyPair();

    // 2. Perform X3DH DH computations
    // DH1 = X25519(IK_A.sk, SPK_B.pk)
    const dh1 = nacl.scalarMult(ikA.secretKey, spkB);
    // DH2 = X25519(EK_A.sk, IK_B.pk)
    const dh2 = nacl.scalarMult(ekA.secretKey, ikB);
    // DH3 = X25519(EK_A.sk, SPK_B.pk)
    const dh3 = nacl.scalarMult(ekA.secretKey, spkB);

    let dhAll: Uint8Array;
    if (bundle.oneTimePreKey) {
      const opkB = hexToBytes(bundle.oneTimePreKey.publicKeyHex);
      // DH4 = X25519(EK_A.sk, OPK_B.pk)
      const dh4 = nacl.scalarMult(ekA.secretKey, opkB);
      dhAll = this.concatUint8Arrays([dh1, dh2, dh3, dh4]);
    } else {
      dhAll = this.concatUint8Arrays([dh1, dh2, dh3]);
    }

    // 3. Derive Master Shared Key (SK) via HKDF
    const saltZero = new Uint8Array(32);
    const masterSecret = hkdf(sha256, dhAll, saltZero, HKDF_INFO_X3DH, 32);

    // 4. Initialize Double Ratchet initial sending step:
    // DH_init = X25519(EK_A.sk, SPK_B.pk)
    const initialDh = nacl.scalarMult(ekA.secretKey, spkB);
    const { nextRootKey, chainKey: sendChainKey } = this.kdfRoot(
      masterSecret,
      initialDh
    );

    const session: SessionRecord = {
      recipientIdentityKeyHex: bundle.identityKeyHex.toLowerCase(),
      rootKeyHex: bytesToHex(nextRootKey),
      sendChainKeyHex: bytesToHex(sendChainKey),
      receiveChainKeyHex: null,
      localDhKeyPair: ekA,
      remoteDhPublicKeyHex: bundle.signedPreKey.publicKeyHex.toLowerCase(),
      sendSequenceNumber: 0,
      receiveSequenceNumber: 0,
      previousChainLength: 0,
      skippedMessageKeys: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.store.saveSession(recipientIdentityKeyHex, session);
    return session;
  }

  /**
   * Encrypts a plaintext message for a recipient using the active Double Ratchet session.
   */
  public async encrypt(
    recipientIdentityKeyHex: string,
    plaintext: string,
    initialBundleContext?: {
      oneTimePreKeyId?: number;
    }
  ): Promise<EncryptedMessage> {
    const session = await this.store.getSession(recipientIdentityKeyHex);
    if (!session) {
      throw new Error(`No active session found for ${recipientIdentityKeyHex}`);
    }

    // If Bob is sending a reply and sendChainKey is not yet initialized:
    if (!session.sendChainKeyHex) {
      if (!session.remoteDhPublicKeyHex) {
        throw new Error('Cannot initialize sending chain without remote DH key');
      }
      const rootKey = hexToBytes(session.rootKeyHex);
      const remoteDh = hexToBytes(session.remoteDhPublicKeyHex);
      const dhSend = nacl.scalarMult(session.localDhKeyPair.secretKey, remoteDh);
      const r = this.kdfRoot(rootKey, dhSend);
      session.rootKeyHex = bytesToHex(r.nextRootKey);
      session.sendChainKeyHex = bytesToHex(r.chainKey);
    }

    // 1. Advance symmetric sending chain KDF
    const currentSendChainKey = hexToBytes(session.sendChainKeyHex);
    const { nextChainKey, messageKey } = this.kdfChain(currentSendChainKey);

    session.sendChainKeyHex = bytesToHex(nextChainKey);
    const seqNum = session.sendSequenceNumber;
    session.sendSequenceNumber++;
    session.updatedAt = Date.now();

    // 2. Encrypt plaintext with messageKey (AEAD secretbox)
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const nonceBytes = nacl.randomBytes(24);
    const ciphertextBytes = nacl.secretbox(
      plaintextBytes,
      nonceBytes,
      messageKey
    );

    // Zeroize message key in memory immediately (Forward Secrecy)
    messageKey.fill(0);

    await this.store.saveSession(recipientIdentityKeyHex, session);

    const identity = await this.store.getIdentity();

    return {
      ephemeralPublicKeyHex: session.localDhKeyPair.publicKeyHex,
      sequenceNumber: seqNum,
      previousChainLength: session.previousChainLength,
      ciphertext: Buffer.from(ciphertextBytes).toString('base64'),
      nonce: bytesToHex(nonceBytes),
      oneTimePreKeyId: initialBundleContext?.oneTimePreKeyId,
      initialIdentityKeyHex: identity.encryptionKey.publicKeyHex,
      initialEphemeralKeyHex: session.localDhKeyPair.publicKeyHex,
    };
  }

  /**
   * Decrypts an incoming message from a sender, performing X3DH initialization or DH Ratchets if needed.
   */
  public async decrypt(
    senderIdentityKeyHex: string,
    message: EncryptedMessage
  ): Promise<string> {
    let session = await this.store.getSession(senderIdentityKeyHex);

    // If no session exists, this must be an initial message for Bob
    if (!session) {
      session = await this.initiateBobSession(senderIdentityKeyHex, message);
    }

    // 1. Check if message key was previously skipped (out-of-order delivery)
    const skippedKeyId = `${message.ephemeralPublicKeyHex.toLowerCase()}:${message.sequenceNumber}`;
    if (session.skippedMessageKeys[skippedKeyId]) {
      const messageKey = hexToBytes(session.skippedMessageKeys[skippedKeyId]);
      delete session.skippedMessageKeys[skippedKeyId];
      await this.store.saveSession(senderIdentityKeyHex, session);

      const plaintext = this.decryptWithKey(message, messageKey);
      messageKey.fill(0);
      return plaintext;
    }

    // 2. Check if remote DH ratchet key changed (Asymmetric Ratchet Step)
    if (
      !session.remoteDhPublicKeyHex ||
      session.remoteDhPublicKeyHex.toLowerCase() !==
        message.ephemeralPublicKeyHex.toLowerCase()
    ) {
      // Skip remaining messages in current receiving chain
      this.skipMessageKeys(session, message.previousChainLength);
      // Perform DH Ratchet step
      this.dhRatchetStep(session, message.ephemeralPublicKeyHex);
    }

    // 3. Skip missing messages in current receiving chain up to sequenceNumber
    this.skipMessageKeys(session, message.sequenceNumber);

    // 4. Advance symmetric receiving chain
    if (!session.receiveChainKeyHex) {
      throw new Error('Receiving chain key not available');
    }
    const currentReceiveChainKey = hexToBytes(session.receiveChainKeyHex);
    const { nextChainKey, messageKey } = this.kdfChain(currentReceiveChainKey);

    session.receiveChainKeyHex = bytesToHex(nextChainKey);
    session.receiveSequenceNumber++;
    session.updatedAt = Date.now();

    await this.store.saveSession(senderIdentityKeyHex, session);

    // 5. Decrypt ciphertext
    const plaintext = this.decryptWithKey(message, messageKey);
    messageKey.fill(0);
    return plaintext;
  }

  /**
   * Initializes Bob's side of the session upon receiving Alice's first message.
   */
  private async initiateBobSession(
    senderIdentityKeyHex: string,
    message: EncryptedMessage
  ): Promise<SessionRecord> {
    if (!message.initialEphemeralKeyHex || !message.initialIdentityKeyHex) {
      throw new Error('Initial message missing X3DH parameters');
    }

    const identity = await this.store.getIdentity();
    const ikB = identity.encryptionKey;
    const ikA = hexToBytes(message.initialIdentityKeyHex);
    const ekA = hexToBytes(message.initialEphemeralKeyHex);

    // Load Bob's Signed PreKey
    const spk = await this.store.getLatestSignedPreKey();
    if (!spk) {
      throw new Error('No Signed PreKey found in store');
    }

    // Load One-Time PreKey if specified
    let opk: OneTimePreKey | null = null;
    if (message.oneTimePreKeyId !== undefined) {
      opk = await this.store.getOneTimePreKey(message.oneTimePreKeyId);
      if (opk) {
        await this.store.removeOneTimePreKey(message.oneTimePreKeyId);
      }
    }

    // Compute X3DH shared secret
    const dh1 = nacl.scalarMult(spk.keyPair.secretKey, ikA);
    const dh2 = nacl.scalarMult(ikB.secretKey, ekA);
    const dh3 = nacl.scalarMult(spk.keyPair.secretKey, ekA);

    let dhAll: Uint8Array;
    if (opk) {
      const dh4 = nacl.scalarMult(opk.keyPair.secretKey, ekA);
      dhAll = this.concatUint8Arrays([dh1, dh2, dh3, dh4]);
    } else {
      dhAll = this.concatUint8Arrays([dh1, dh2, dh3]);
    }

    const saltZero = new Uint8Array(32);
    const masterSecret = hkdf(sha256, dhAll, saltZero, HKDF_INFO_X3DH, 32);

    // Initial receiving step with Alice's ephemeral DH key
    const initialDh = nacl.scalarMult(
      spk.keyPair.secretKey,
      hexToBytes(message.ephemeralPublicKeyHex)
    );
    const { nextRootKey, chainKey: receiveChainKey } = this.kdfRoot(
      masterSecret,
      initialDh
    );

    // Bob generates his DH ratchet keypair for subsequent replies
    const dhsB = this.generateCurve25519KeyPair();

    const session: SessionRecord = {
      recipientIdentityKeyHex: senderIdentityKeyHex.toLowerCase(),
      rootKeyHex: bytesToHex(nextRootKey),
      sendChainKeyHex: null,
      receiveChainKeyHex: bytesToHex(receiveChainKey),
      localDhKeyPair: dhsB,
      remoteDhPublicKeyHex: message.ephemeralPublicKeyHex.toLowerCase(),
      sendSequenceNumber: 0,
      receiveSequenceNumber: 0,
      previousChainLength: 0,
      skippedMessageKeys: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.store.saveSession(senderIdentityKeyHex, session);
    return session;
  }

  /**
   * Performs an asymmetric DH Ratchet step when remote DH key changes.
   */
  private dhRatchetStep(session: SessionRecord, newRemoteDhPublicKeyHex: string): void {
    const rootKey = hexToBytes(session.rootKeyHex);
    const remoteDh = hexToBytes(newRemoteDhPublicKeyHex);

    session.previousChainLength = session.sendSequenceNumber;
    session.sendSequenceNumber = 0;
    session.receiveSequenceNumber = 0;
    session.remoteDhPublicKeyHex = newRemoteDhPublicKeyHex.toLowerCase();

    // 1. Receiving step: compute DH with our current local key and new remote key
    const dhReceive = nacl.scalarMult(session.localDhKeyPair.secretKey, remoteDh);
    const r1 = this.kdfRoot(rootKey, dhReceive);
    session.receiveChainKeyHex = bytesToHex(r1.chainKey);

    // 2. Sending step: generate new local keypair and compute DH with new remote key
    session.localDhKeyPair = this.generateCurve25519KeyPair();
    const dhSend = nacl.scalarMult(session.localDhKeyPair.secretKey, remoteDh);
    const r2 = this.kdfRoot(r1.nextRootKey, dhSend);

    session.rootKeyHex = bytesToHex(r2.nextRootKey);
    session.sendChainKeyHex = bytesToHex(r2.chainKey);
  }

  /**
   * Advances receiving chain and stores skipped keys for out-of-order delivery.
   */
  private skipMessageKeys(session: SessionRecord, until: number): void {
    if (!session.receiveChainKeyHex || !session.remoteDhPublicKeyHex) return;

    if (session.receiveSequenceNumber + MAX_SKIP_MESSAGES < until) {
      throw new Error('Too many skipped messages');
    }

    let currentReceiveChain = hexToBytes(session.receiveChainKeyHex);
    while (session.receiveSequenceNumber < until) {
      const { nextChainKey, messageKey } = this.kdfChain(currentReceiveChain);
      currentReceiveChain = nextChainKey;

      const keyId = `${session.remoteDhPublicKeyHex.toLowerCase()}:${session.receiveSequenceNumber}`;
      session.skippedMessageKeys[keyId] = bytesToHex(messageKey);
      session.receiveSequenceNumber++;
    }
    session.receiveChainKeyHex = bytesToHex(currentReceiveChain);
  }

  private decryptWithKey(
    message: EncryptedMessage,
    messageKey: Uint8Array
  ): string {
    const ciphertextBytes = Buffer.from(message.ciphertext, 'base64');
    const nonceBytes = hexToBytes(message.nonce);

    const decrypted = nacl.secretbox.open(
      ciphertextBytes,
      nonceBytes,
      messageKey
    );
    if (!decrypted) {
      throw new Error('Decryption failed or message corrupted / tampered with');
    }

    return new TextDecoder().decode(decrypted);
  }

  private kdfRoot(
    rootKey: Uint8Array,
    dhOut: Uint8Array
  ): { nextRootKey: Uint8Array; chainKey: Uint8Array } {
    const derived = hkdf(sha256, dhOut, rootKey, HKDF_INFO_ROOT, 64);
    return {
      nextRootKey: derived.slice(0, 32),
      chainKey: derived.slice(32, 64),
    };
  }

  private kdfChain(
    chainKey: Uint8Array
  ): { nextChainKey: Uint8Array; messageKey: Uint8Array } {
    const inputConstant = new Uint8Array([0x01]);
    const derived = hkdf(sha256, inputConstant, chainKey, HKDF_INFO_CHAIN, 64);
    return {
      nextChainKey: derived.slice(0, 32),
      messageKey: derived.slice(32, 64),
    };
  }

  private generateCurve25519KeyPair(): Curve25519KeyPair {
    const keyPair = nacl.box.keyPair();
    return {
      publicKey: keyPair.publicKey,
      secretKey: keyPair.secretKey,
      publicKeyHex: bytesToHex(keyPair.publicKey),
    };
  }

  private concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLen = arrays.reduce((acc, curr) => acc + curr.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
}

