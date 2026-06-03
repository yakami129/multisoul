import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { type SpecDraft } from '../types';
import { SpecsListScreen } from './SpecsListScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-gesture-handler', () => ({
  Swipeable: ({ children, renderRightActions }: any) => (
    <>
      {children}
      {renderRightActions?.()}
    </>
  ),
}));

const baseSpec: SpecDraft = {
  id: 'spec-1',
  title: 'Offline First Spec Manager',
  slug: 'offline-first-spec-manager',
  status: 'draft',
  targetAgentId: 'agent-1',
  targetEndpointId: 'endpoint-1',
  targetRepoPath: '/repo/multisoul',
  targetAgentName: 'MultiSoul iOS',
  targetRuntime: 'codex',
  questions: [],
  answers: [],
  createdAt: 1,
  updatedAt: Date.now(),
};

/**
 * 场景：没有 spec 时展示 Specs 空状态和创建入口。
 *
 * 数据构造：
 *   specs = []，表示用户第一次打开 Specs Tab。
 *
 * 执行过程：
 *   1. 渲染 SpecsListScreen。
 *   2. 查找空状态文案。
 *
 * 预期结果：
 *   - 正断言：显示 Create your first spec。
 *   - 正断言：显示 New Spec 入口。
 */
test('renders empty state for first spec creation', () => {
  const { getByText } = render(
    <SpecsListScreen specs={[]} onCreateSpec={() => {}} onOpenSpec={() => {}} />,
  );

  expect(getByText('Create your first spec')).toBeTruthy();
  expect(getByText('New Spec')).toBeTruthy();
});

/**
 * 场景：Draft 与 Review spec 应显示可扫视的状态标签。
 *
 * 数据构造：
 *   draftSpec.status = draft。
 *   reviewSpec.status = review。
 *
 * 执行过程：
 *   1. 渲染两个 spec。
 *   2. 查找标题和状态标签。
 *
 * 预期结果：
 *   - 正断言：Draft row 显示 Draft。
 *   - 正断言：Review row 显示 Review。
 *   - 负断言：没有显示空状态，说明列表路径生效。
 */
test('renders draft and review rows with status labels', () => {
  const reviewSpec: SpecDraft = {
    ...baseSpec,
    id: 'spec-2',
    title: 'Cloud Relay Setup',
    status: 'review',
  };
  const { getAllByText, getByText, queryByText } = render(
    <SpecsListScreen
      specs={[baseSpec, reviewSpec]}
      onCreateSpec={() => {}}
      onOpenSpec={() => {}}
    />,
  );

  expect(getByText('Offline First Spec Manager')).toBeTruthy();
  expect(getAllByText('Draft').length).toBeGreaterThanOrEqual(1);
  fireEvent.press(getByText('Review'));
  expect(getByText('Cloud Relay Setup')).toBeTruthy();
  expect(queryByText('Create your first spec')).toBeNull();
});

/**
 * 场景：点击 spec row 应打开对应 spec 详情。
 *
 * 数据构造：
 *   spec.id = spec-1。
 *   onOpenSpec = jest.fn，用于记录被打开的 id。
 *
 * 执行过程：
 *   1. 渲染 SpecsListScreen。
 *   2. 点击 spec 标题。
 *
 * 预期结果：
 *   - 正断言：onOpenSpec 收到 spec-1。
 *   - 负断言：onCreateSpec 不应被调用，说明 row tap 没误触创建入口。
 */
test('opens selected spec row', () => {
  const onOpenSpec = jest.fn();
  const onCreateSpec = jest.fn();
  const { getByText } = render(
    <SpecsListScreen specs={[baseSpec]} onCreateSpec={onCreateSpec} onOpenSpec={onOpenSpec} />,
  );

  fireEvent.press(getByText('Offline First Spec Manager'));

  expect(onOpenSpec).toHaveBeenCalledWith('spec-1');
  expect(onCreateSpec).not.toHaveBeenCalled();
});

/**
 * 场景：Spec 列表行左滑后点击 DELETE，应请求删除对应 spec。
 *
 * 数据构造：
 *   spec-1.title = Offline First Spec Manager，目标删除项。
 *   spec-2.title = Cloud Relay Setup，同一 segment 中的非目标项。
 *   mocked Swipeable 会直接渲染 renderRightActions，模拟左滑后露出的右侧动作。
 *
 * 执行过程：
 *   1. 渲染两个 draft spec，并传入 onDeleteSpec spy。
 *   2. 点击第一个 DELETE 动作。
 *   3. 检查删除回调和打开回调。
 *
 * 预期结果：
 *   - 正断言：onDeleteSpec 收到 spec-1。
 *   - 负断言：onDeleteSpec 不应收到 spec-2，说明没有误删相邻行。
 *   - 负断言：onOpenSpec 不应被调用，说明删除动作没有触发行打开。
 */
test('pressing swipe DELETE requests deletion for the matching spec only', () => {
  const onDeleteSpec = jest.fn();
  const onOpenSpec = jest.fn();
  const otherSpec: SpecDraft = {
    ...baseSpec,
    id: 'spec-2',
    title: 'Cloud Relay Setup',
  };
  const { getAllByText } = render(
    <SpecsListScreen
      specs={[baseSpec, otherSpec]}
      onCreateSpec={() => {}}
      onOpenSpec={onOpenSpec}
      onDeleteSpec={onDeleteSpec}
    />,
  );

  fireEvent.press(getAllByText('DELETE')[0]);

  expect(onDeleteSpec).toHaveBeenCalledWith('spec-1');
  expect(onDeleteSpec).not.toHaveBeenCalledWith('spec-2');
  expect(onOpenSpec).not.toHaveBeenCalled();
});
