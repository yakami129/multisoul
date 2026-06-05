import { StyleSheet } from 'react-native';

export const splashScreenStyles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#0D0D0D',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
});
