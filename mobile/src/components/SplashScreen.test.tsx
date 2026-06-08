import { render } from '@testing-library/react-native';
import { SplashScreen } from './SplashScreen';

const mockUseEventListener = jest.fn((_player, eventName, callback) => {
  if (eventName === 'playToEnd') {
    callback();
  }
});

const mockUseVideoPlayer = jest.fn(
  (_source, setup?: (player: { loop: boolean; muted: boolean; play: jest.Mock }) => void) => {
    const player = { loop: true, muted: false, play: jest.fn() };
    setup?.(player);
    return player;
  },
);

jest.mock('expo', () => ({
  useEventListener: (...args: unknown[]) => mockUseEventListener(...args),
}));

jest.mock(
  'expo-video',
  () => {
    const React = require('react');
    const { View } = require('react-native');

    return {
      VideoView: ({ testID = 'splash-video', ...props }) => <View testID={testID} {...props} />,
      useVideoPlayer: (...args: unknown[]) => mockUseVideoPlayer(...args),
    };
  },
  { virtual: true },
);

beforeEach(() => {
  mockUseEventListener.mockClear();
  mockUseVideoPlayer.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/// 视频开屏：播放当前唯一的 bundled mp4，并在播放结束后进入应用
///
/// 数据构造（含关键数值的推导过程）：
///   videos.length = 1
///   Math.random() = 0.42 → floor(0.42 * 1) = 0 → 选择 starfield-blue.mp4
///   player.play 调用次数 = 1 次（首次挂载立即开始播放）
///   onComplete 调用次数 = 1 次（mock 的 playToEnd 事件触发一次）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 固定 Math.random 为 0.42 渲染 SplashScreen → useVideoPlayer 接收 starfield-blue.mp4
///   2. VideoView 渲染为全屏 cover 视频 → 不显示原生控制条
///   3. 播放器设置 loop=false、muted=true → 不无限停留且不打断其他声音
///   4. mock useEventListener 触发 playToEnd → SplashScreen 调用 onComplete
///
/// 预期结果：
///   - 断言 A：VideoView 存在，说明开屏动画已经切换到视频
///   - 断言 C：nativeControls=false、loop=false、muted=true，说明开屏不会暴露播放器 UI、无限停留或抢音频
///   - 断言 D：onComplete 被调用一次，说明视频结束后能进入应用
it('plays the bundled splash video and completes when playback ends', () => {
  const onComplete = jest.fn();
  jest.spyOn(Math, 'random').mockReturnValueOnce(0.42);

  const { getByTestId } = render(<SplashScreen onComplete={onComplete} />);
  const player = mockUseVideoPlayer.mock.results[0]?.value;
  const source = mockUseVideoPlayer.mock.calls[0]?.[0];

  expect(getByTestId('splash-video')).toBeTruthy();
  expect(`${JSON.stringify(source)}`).toContain(
    'starfield-blue.mp4',
    'the bundled starfield splash video should be selected',
  );
  expect(mockUseVideoPlayer).toHaveBeenCalledWith(source, expect.any(Function));
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(player.loop).toBe(false, 'splash video should finish once so the app can continue');
  expect(player.muted).toBe(true, 'splash video should not interrupt background audio');
  expect(getByTestId('splash-video').props.nativeControls).toBe(
    false,
    'splash video must hide native controls',
  );
  expect(getByTestId('splash-video').props.contentFit).toBe(
    'cover',
    'splash video must cover the launch viewport',
  );
  expect(mockUseEventListener).toHaveBeenCalledWith(player, 'playToEnd', expect.any(Function));
  expect(onComplete).toHaveBeenCalledTimes(1);
});
