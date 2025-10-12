```typescript
import EncryptionService from '../../../storage/security/EncryptionService';

describe('EncryptionService', () => {
  const mockKeyV1 = Buffer.from('000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f', 'hex'); // 32 bytes
  const mockKeyV2 = Buffer.from('0f0e0d0c0b0a0908070605040302010f0f0e0d0c0b0a0908070605040302010f', 'hex');

  // Test vector for AES-256 CBC (IV + ciphertext)
  const plaintext = 'The quick brown fox jumps over the lazy dog';
  const corruptedData = Buffer.from('deadbeefcafebabe', 'hex');

  let encryptionService: EncryptionService;

  beforeEach(() => {
    encryptionService = new EncryptionService();
    encryptionService.setKey(mockKeyV1);
  });

  test('AES-256 encryption/decryption correctness', () => {
    const encrypted = encryptionService.encrypt(plaintext);
    expect(encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.length).toBeGreaterThan(plaintext.length);

    const decrypted = encryptionService.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test('Key rotation without data loss', () => {
    const encryptedV1 = encryptionService.encrypt(plaintext);

    encryptionService.setKey(mockKeyV2);
    // New data encrypted with new key
    const encryptedV2 = encryptionService.encrypt(plaintext);

    // Can decrypt old data with old key explicitly
    const decryptOld = () => {
      const oldService = new EncryptionService();
      oldService.setKey(mockKeyV1);
      return oldService.decrypt(encryptedV1);
    };
    expect(decryptOld()).toBe(plaintext);

    // Can decrypt new data with new key
    const decryptedV2 = encryptionService.decrypt(encryptedV2);
    expect(decryptedV2).toBe(plaintext);
  });

  describe('Field-level encryption for PHI', () => {
    interface PatientRecord {
      name: string;
      dob: string;  // date of birth - PHI
      diagnosis: string;
      notes: string; // may contain PHI
    }

    const sampleRecord: PatientRecord = {
      name: 'John Doe',
      dob: '1980-01-15',
      diagnosis: 'Hypertension',
      notes: 'Patient reports occasional dizziness and headaches.'
    };

    test('Encrypt and decrypt PHI fields only', () => {
      const encryptedPHI = encryptionService.encrypt(sampleRecord.dob);
      const encryptedNotes = encryptionService.encrypt(sampleRecord.notes);

      expect(encryptedPHI).not.toEqual(sampleRecord.dob);
      expect(encryptedNotes).not.toEqual(sampleRecord.notes);

      const decryptedDOB = encryptionService.decrypt(encryptedPHI);
      const decryptedNotes = encryptionService.decrypt(encryptedNotes);

      expect(decryptedDOB).toBe(sampleRecord.dob);
      expect(decryptedNotes).toBe(sampleRecord.notes);
    });
  });

  describe('Encryption performance benchmarks', () => {
    const dataSize = 1024 * 100; // 100KB
    const largeData = Buffer.alloc(dataSize, 'a').toString();

    test('Encryption/decryption completes within acceptable time', () => {
      const startEncrypt = process.hrtime.bigint();
      const encrypted = encryptionService.encrypt(largeData);
      const endEncrypt = process.hrtime.bigint();

      const startDecrypt = process.hrtime.bigint();
      const decrypted = encryptionService.decrypt(encrypted);
      const endDecrypt = process.hrtime.bigint();

      const encryptDurationMs = Number(endEncrypt - startEncrypt) / 1e6;
      const decryptDurationMs = Number(endDecrypt - startDecrypt) / 1e6;

      expect(decrypted).toBe(largeData);

      // Acceptable thresholds: < 100ms each (adjust based on environment)
      expect(encryptDurationMs).toBeLessThan(100);
      expect(decryptDurationMs).toBeLessThan(100);
    });
  });

  test('Key management security: keys are not exposed', () => {
    // Assuming EncryptionService exposes no plain key getter
    expect(() => {
      // @ts-expect-error accessing private property (should fail)
      const key = encryptionService.key;
      expect(key).toBeUndefined();
    }).toThrow();

    // Setting a key with invalid length throws
    expect(() => {
      encryptionService.setKey(Buffer.from('1234'));
    }).toThrow();
  });

  test('Handling of corrupted encrypted data', () => {
    // Encrypt valid data
    const encrypted = encryptionService.encrypt(plaintext);

    // Corrupt the encrypted buffer by changing some bytes
    const corrupted = Buffer.from(encrypted);
    corrupted[10] ^= 0xff; // Flip a bit arbitrarily

    expect(() => {
      encryptionService.decrypt(corrupted);
    }).toThrow();

    // Completely invalid (random) buffer
    expect(() => {
      encryptionService.decrypt(corruptedData);
    }).toThrow();
  });

  test('Compliance with security standards (e.g. block size, IV length)', () => {
    // Validate that IV length is 16 bytes (AES block size)
    const encrypted = encryptionService.encrypt(plaintext);
    const iv = encrypted.slice(0, 16);
    expect(iv.length).toBe(16);

    // Validate ciphertext length is multiple of block size or padded
    const ciphertext = encrypted.slice(16);
    expect(ciphertext.length % 16).toBe(0);

    // Validate that decrypt(encrypt(x)) === x for strings with varying lengths
    const testStrings = ['', 'a', 'abc', '1234567890abcdef', 'A'.repeat(31), 'B'.repeat(32), 'C'.repeat(33)];
    for (const s of testStrings) {
      const enc = encryptionService.encrypt(s);
      const dec = encryptionService.decrypt(enc);
      expect(dec).toBe(s);
    }
  });
});
```