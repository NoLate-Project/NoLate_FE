module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {files: ['ios/NoLateShareExtension/TicketWebPage.js'], env: {browser: true}},
  ],
};
