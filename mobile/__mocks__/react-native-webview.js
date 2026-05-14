// Minimal mock for react-native-webview in Jest environment.
// WebView renders nothing; onMessage/onLoad callbacks can be triggered via ref.
const React = require('react');
const { View } = require('react-native');

const WebView = React.forwardRef(function WebView(
  { testID, onMessage, onLoadEnd, onError },
  ref,
) {
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: jest.fn(),
    postMessage: jest.fn(),
  }));

  // Expose callbacks on the View so tests can trigger them via fireEvent
  return (
    <View
      testID={testID ?? 'webview'}
      onMessage={onMessage}
      onLoadEnd={onLoadEnd}
      onError={onError}
    />
  );
});

module.exports = { WebView, default: WebView };
