const React = require('react');
const { View } = require('react-native');

const GestureHandlerRootView = ({ children, style }) =>
  React.createElement(View, { style }, children);

const GestureDetector = ({ children }) => children;

const Gesture = {
  Pinch: () => ({
    onUpdate: function () {
      return this;
    },
    onEnd: function () {
      return this;
    },
  }),
  Pan: () => ({
    onUpdate: function () {
      return this;
    },
    onEnd: function () {
      return this;
    },
  }),
  Simultaneous: () => ({}),
};

module.exports = {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
};
