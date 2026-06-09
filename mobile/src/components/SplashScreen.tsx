import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { splashScreenStyles as s } from './splashScreenStyles';
import splashVideo from '../../assets/splash/starfield-blue.mp4';

const splashVideos = [splashVideo];
const playbackFallbackMs = 7000;

interface Props {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: Props) {
  const completedRef = useRef(false);
  const videoIndexRef = useRef(Math.floor(Math.random() * splashVideos.length));
  const player = useVideoPlayer(splashVideos[videoIndexRef.current], (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = true;
    videoPlayer.play();
  });

  const completeOnce = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEventListener(player, 'playToEnd', completeOnce);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') {
      completeOnce();
    }
  });

  useEffect(() => {
    const fallback = setTimeout(completeOnce, playbackFallbackMs);
    return () => clearTimeout(fallback);
  }, [completeOnce]);

  return (
    <View style={s.root}>
      <VideoView
        testID="splash-video"
        player={player}
        style={s.video}
        nativeControls={false}
        contentFit="cover"
        pointerEvents="none"
      />
    </View>
  );
}
