// Global mock for react-native-keychain
jest.mock('react-native-keychain', () => {
  let store = {};
  return {
    setGenericPassword: jest.fn(async (_username, password, options) => {
      const key = options?.service || 'default';
      store[key] = password;
      return { service: key, storage: 'keychain' };
    }),
    getGenericPassword: jest.fn(async (options) => {
      const key = options?.service || 'default';
      if (store[key]) {
        return { username: 'identity', password: store[key], service: key, storage: 'keychain' };
      }
      return false;
    }),
    resetGenericPassword: jest.fn(async (options) => {
      const key = options?.service || 'default';
      delete store[key];
      return true;
    }),
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
    },
    SECURITY_LEVEL: {
      SECURE_HARDWARE: 'SECURE_HARDWARE',
    },
    __clearStore: () => {
      store = {};
    },
  };
});

