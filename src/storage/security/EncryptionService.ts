```ts
import crypto from 'crypto';
import sodium from 'libsodium-wrappers';

type EncryptionKey = {
  id: string;
  key: Buffer; // 32 bytes for AES-256
  createdAt: Date;
};

type PHIFieldConfig = {
  maskLength?: number;
  maskChar?: string;
};

export class EncryptionService {
  private static instance: EncryptionService;
  private keys: EncryptionKey[] = [];
  private activeKeyId: string | null = null;
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12; // recommended for GCM
  private phiMaskChar = '*';
  private phiDefaultMaskLength = 6;

  private constructor() {}

  public static async getInstance() {
    if (!EncryptionService.instance) {
      EncryptionService.instance = new EncryptionService();
      await sodium.ready;
      // Initialize or load keys here (simulate secure key vault access)
      await EncryptionService.instance.loadKeys();
    }
    return EncryptionService.instance;
  }

  /**
   * Simulates loading keys from an HSM or secure key vault.
   * In real implementation, replace this with actual HSM/key vault API calls.
   * The keys should not be stored in app memory in plaintext in real production environments.
   */
  private async loadKeys() {
    // Placeholder: Load keys securely; here we generate one key if none exist.
    if (this.keys.length === 0) {
      const keyId = crypto.randomUUID();
      const key = crypto.randomBytes(32);
      this.keys.push({ id: keyId, key, createdAt: new Date() });
      this.activeKeyId = keyId;
    }
  }

  /**
   * Rotate encryption key: generate new key and set as active.
   * Re-encrypt stored data using new key needs to be handled outside.
   */
  public async rotateKey() {
    const newKeyId = crypto.randomUUID();
    const newKey = crypto.randomBytes(32);
    this.keys.push({ id: newKeyId, key: newKey, createdAt: new Date() });
    this.activeKeyId = newKeyId;
    // Trigger background re-encryption of data outside this class.
  }

  /**
   * Get active encryption key buffer.
   */
  private getActiveKey(): Buffer {
    if (!this.activeKeyId) throw new Error('No active encryption key configured');
    const active = this.keys.find(k => k.id === this.activeKeyId);
    if (!active) throw new Error('Active key not found');
    return active.key;
  }

  /**
   * AES-256-GCM encrypt data at rest.
   * Returns: base64 encoded iv + encrypted + auth tag string.
   */
  public encryptData(plainText: string): string {
    const key = this.getActiveKey();
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv, { authTagLength: 16 });

    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Concatenate iv + encrypted + authTag
    const encryptedBuffer = Buffer.concat([iv, encrypted, authTag]);
    return encryptedBuffer.toString('base64');
  }

  /**
   * Decrypt base64 encrypted string (iv + ciphertext + auth tag).
   */
  public decryptData(encryptedBase64: string): string {
    const key = this.getActiveKey();
    const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');

    if (encryptedBuffer.length < this.ivLength + 16)
      throw new Error('Invalid encrypted data');

    const iv = encryptedBuffer.slice(0, this.ivLength);
    const authTag = encryptedBuffer.slice(encryptedBuffer.length - 16);
    const ciphertext = encryptedBuffer.slice(this.ivLength, encryptedBuffer.length - 16);

    const decipher = crypto.createDecipheriv(this.algorithm, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Field-level encryption of PHI data using libsodium secret-key authenticated encryption (XSalsa20 + Poly1305)
   */
  public encryptPHIField(plainText: string): string {
    const key = this.getActiveKey();
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const cipher = sodium.crypto_secretbox_easy(Buffer.from(plainText, 'utf8'), nonce, key);
    // Store nonce + cipher combined (both base64)
    return Buffer.from(nonce).toString('base64') + ':' + Buffer.from(cipher).toString('base64');
  }

  /**
   * Decrypts a PHI encrypted field string (nonce:cipher base64).
   */
  public decryptPHIField(encrypted: string): string {
    const key = this.getActiveKey();
    const [nonceB64, cipherB64] = encrypted.split(':');
    if (!nonceB64 || !cipherB64) throw new Error('Invalid PHI encrypted value');

    const nonce = Buffer.from(nonceB64, 'base64');
    const cipher = Buffer.from(cipherB64, 'base64');
    const decrypted = sodium.crypto_secretbox_open_easy(cipher, nonce, key);
    if (!decrypted) throw new Error('Failed to decrypt PHI field');
    return Buffer.from(decrypted).toString('utf8');
  }

  /**
   * Data masking for non-authorized users.
   * Default mask length is configurable.
   */
  public maskData(value: string, config: PHIFieldConfig = {}): string {
    const maskChar = config.maskChar ?? this.phiMaskChar;
    const maskLength = config.maskLength ?? Math.min(value.length, this.phiDefaultMaskLength);
    if (value.length <= maskLength) return maskChar.repeat(value.length);
    return maskChar.repeat(maskLength) + value.slice(maskLength);
  }

  /**
   * Optimized bulk encryption using libsodium for batch PHI field encryption.
   * Accepts an array of strings and returns an array of encrypted strings.
   * Minimizes overhead of multiple calls.
   */
  public bulkEncryptPHIFields(plainTexts: string[]): string[] {
    const key = this.getActiveKey();
    const encryptedArray: string[] = [];

    for (const pt of plainTexts) {
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const cipher = sodium.crypto_secretbox_easy(Buffer.from(pt, 'utf8'), nonce, key);
      encryptedArray.push(Buffer.from(nonce).toString('base64') + ':' + Buffer.from(cipher).toString('base64'));
    }

    return encryptedArray;
  }

  /**
   * HIPAA compliance metadata helper
   */
  public getHIPAASecurityProperties() {
    return {
      algorithm: this.algorithm,
      keyLength: 256,
      keyRotationPolicyDays: 90,
      encryptionMode: 'AES-256-GCM with libsodium secretbox for PHI fields',
      keyStorage: 'Hardware Security Module or Key Vault integration required',
      dataMasking: 'Applied to PHI when user context lacks decryption permissions',
      accessControl: 'Enforce strict RBAC and audit logging',
    };
  }
}
```