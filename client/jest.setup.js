const mockKeychainStore = new Map();

jest.mock(
  'react-native-keychain',
  () => ({
    setGenericPassword: jest.fn(async (username, password, options = {}) => {
      const service = options.service || 'default';
      mockKeychainStore.set(service, { username, password });
      return { service, storage: 'mock' };
    }),
    getGenericPassword: jest.fn(async (options = {}) => {
      const service = options.service || 'default';
      return mockKeychainStore.get(service) || false;
    }),
    resetGenericPassword: jest.fn(async (options = {}) => {
      const service = options.service || 'default';
      mockKeychainStore.delete(service);
      return true;
    }),
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
    },
    SECURITY_LEVEL: {
      SECURE_HARDWARE: 'SecureHardware',
    },
  }),
  { virtual: true }
);

