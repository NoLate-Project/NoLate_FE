module.exports = {
  preset: 'react-native',
  moduleNameMapper: {
    '^expo/virtual/env$': '<rootDir>/__mocks__/expoVirtualEnv.js',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
