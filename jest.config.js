module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // pnpm stores packages below node_modules/.pnpm before linking them back into
  // node_modules. Allow React Native's ESM-flavoured Jest setup through both
  // path layers so focused and full suites behave the same under npm or pnpm.
  transformIgnorePatterns: [
    'node_modules/.pnpm/(?!(react-native|@react-native\\+.*)@)',
    'node_modules/(?!\\.pnpm/|((jest-)?react-native|@react-native(-community)?)/)',
  ],
};
