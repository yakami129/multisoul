import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { clearDiagnosticsEntries, getDiagnosticsLogText } from '@/services/diagnosticsLog';
import { MarkdownImage } from './MarkdownImage';

const SERVER_URL = 'http://localhost:8765';
const TOKEN = 'test-token';
const originalFetch = global.fetch;
const originalPrefetch = Image.prefetch;

afterEach(() => {
  global.fetch = originalFetch;
  Image.prefetch = originalPrefetch;
  jest.clearAllMocks();
});

/// test_markdown_image_renders_thumbnail: renders <Image> with correct source URI for a remote HTTPS URL
///
/// Data construction:
///   src = 'https://example.com/photo.png' (remote HTTPS URL)
///   alt = 'a photo'
///
/// Execution:
///   1. render MarkdownImage with HTTPS src → resolveSource returns { uri: src }
///   2. Image is rendered with that URI as source
///
/// Expected:
///   - testID="markdown-image-thumb" exists: thumbnail Image is rendered
///   - source.uri equals the original HTTPS URL: no transformation applied
///   - source.cache is absent: RN Image should use default loading path, avoiding iOS force-cache failures
test('test_markdown_image_renders_thumbnail', () => {
  const { getByTestId } = render(
    <MarkdownImage
      src="https://example.com/photo.png"
      alt="a photo"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  const img = getByTestId('markdown-image-thumb');
  // assertion failure = thumbnail Image not rendered for HTTPS URL
  expect(img).toBeTruthy();
  // assertion failure = source URI was transformed when it should be used as-is
  expect(img.props.source.uri).toBe('https://example.com/photo.png');
  // assertion failure = iOS force-cache is back; it can make Image fail while fetch still returns 200
  expect(img.props.source.cache).toBeUndefined();
});

/// test_markdown_image_thumbnail_has_stable_size: markdown images must not depend on inherited parent width
///
/// Data construction:
///   src = 'https://example.com/photo.png' (remote HTTPS URL)
///   thumbnail frame target = 240 x 200 px (fixed render surface for chat bubbles)
///
/// Execution:
///   1. render MarkdownImage with HTTPS src
///   2. find testID="markdown-image-thumb-press" wrapper
///   3. inspect wrapper style passed to React Native
///
/// Expected:
///   - positive: wrapper width is 240, giving Image a non-zero render surface
///   - positive: wrapper height is 200, matching existing thumbnail height
///   - negative: wrapper width is not '100%', avoiding zero-width markdown parent layouts
test('test_markdown_image_thumbnail_has_stable_size', () => {
  const { getByTestId } = render(
    <MarkdownImage
      src="https://example.com/photo.png"
      alt="a photo"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  const frame = getByTestId('markdown-image-thumb-press');
  expect(frame.props.style.width).toBe(
    240,
    'thumbnail frame should have a concrete width so iOS Image does not render blank',
  );
  expect(frame.props.style.height).toBe(
    200,
    'thumbnail frame should preserve the existing 200px preview height',
  );
  expect(frame.props.style.width).not.toBe(
    '100%',
    'thumbnail frame should not depend on markdown parent percentage width',
  );
});

/// test_markdown_image_local_path_converts_to_files_url: local path → /api/v1/files?path= with token query param
///
/// Data construction:
///   src = '/tmp/img.png' (absolute local path starting with '/')
///   serverUrl = 'http://localhost:8765', apiKey = 'test-token' (from mock store)
///
/// Execution:
///   1. render MarkdownImage with local path src
///   2. resolveSource detects leading '/' → builds files API URL with encoded path and token
///
/// Expected:
///   - source.uri contains '/api/v1/files?path=': correct endpoint used
///   - source.uri contains encoded path '%2Ftmp%2Fimg.png': path is URL-encoded
///   - source.uri contains 'token=test-token': auth token in query string (RN Image doesn't support custom headers)
test('test_markdown_image_local_path_converts_to_files_url', () => {
  const { getByTestId } = render(
    <MarkdownImage src="/tmp/img.png" alt="local" serverUrl={SERVER_URL} token={TOKEN} />,
  );

  const img = getByTestId('markdown-image-thumb');
  // assertion failure = local path not converted to files API URL
  expect(img.props.source.uri).toContain('/api/v1/files?path=');
  // assertion failure = path not URL-encoded in the query string
  expect(img.props.source.uri).toContain(encodeURIComponent('/tmp/img.png'));
  // assertion failure = token not present as query param (RN Image doesn't support custom headers)
  expect(img.props.source.uri).toContain('token=test-token');
  expect(img.props.source.cache).toBe(
    'force-cache',
    'local files URLs should reuse the iOS decode cache similar to CDN images where safe',
  );
});

/// test_markdown_image_local_path_trims_server_url_slash: base URL with trailing slash should not create //api path
///
/// Data construction:
///   src = '/tmp/img.png' (absolute local path)
///   serverUrl = 'http://localhost:8765/' (manual endpoint entry with trailing slash)
///   token = 'test-token'
///
/// Execution:
///   1. render MarkdownImage with local path and trailing-slash serverUrl
///   2. resolveSource trims one trailing slash before appending /api/v1/files
///
/// Expected:
///   - positive: source.uri starts with 'http://localhost:8765/api/v1/files'
///   - negative: source.uri does not contain '8765//api', which would miss the Axum route
test('test_markdown_image_local_path_trims_server_url_slash', () => {
  const { getByTestId } = render(
    <MarkdownImage src="/tmp/img.png" alt="local" serverUrl={`${SERVER_URL}/`} token={TOKEN} />,
  );

  const img = getByTestId('markdown-image-thumb');
  expect(img.props.source.uri.startsWith(`${SERVER_URL}/api/v1/files`)).toBe(
    true,
    'local image URL should append /api/v1/files after a normalized server URL',
  );
  expect(img.props.source.uri.includes('8765//api')).toBe(
    false,
    'local image URL should not contain a double slash before api',
  );
});

/// test_markdown_image_opens_fullscreen_on_press: pressing thumbnail sets modal visible
///
/// Data construction:
///   src = 'https://example.com/photo.png'
///   alt = 'photo'
///
/// Execution:
///   1. render MarkdownImage → previewVisible=false → modal not in tree
///   2. press testID="markdown-image-thumb-press" → setPreviewVisible(true)
///   3. modal becomes visible → testID="markdown-image-modal" appears in tree
///
/// Expected:
///   - before press: queryByTestId('markdown-image-modal') is null (modal hidden)
///   - after press: getByTestId('markdown-image-modal') is truthy (modal visible)
test('test_markdown_image_opens_fullscreen_on_press', async () => {
  const { getByTestId, queryByTestId } = render(
    <MarkdownImage
      src="https://example.com/photo.png"
      alt="photo"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  // assertion failure = modal should be hidden initially
  expect(queryByTestId('markdown-image-modal')).toBeNull();

  await act(async () => {
    fireEvent.press(getByTestId('markdown-image-thumb-press'));
  });

  // assertion failure = modal did not open after pressing thumbnail
  expect(getByTestId('markdown-image-modal')).toBeTruthy();
});

/// test_markdown_image_fullscreen_image_fills_modal: fullscreen preview should use the full modal surface
///
/// Data construction:
///   src = 'https://example.com/photo.png'
///   alt = 'photo'
///   expected fullscreen frame = width 100%, height 100%
///
/// Execution:
///   1. render MarkdownImage
///   2. press thumbnail → fullscreen Modal appears
///   3. inspect markdown-image-fullscreen style
///
/// Expected:
///   - positive: fullscreen Image width is '100%'
///   - positive: fullscreen Image height is '100%'
///   - negative: fullscreen Image height is not '80%', avoiding non-fullscreen previews
test('test_markdown_image_fullscreen_image_fills_modal', async () => {
  const { getByTestId } = render(
    <MarkdownImage
      src="https://example.com/photo.png"
      alt="photo"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  await act(async () => {
    fireEvent.press(getByTestId('markdown-image-thumb-press'));
  });

  const style = StyleSheet.flatten(getByTestId('markdown-image-fullscreen').props.style);
  expect(style.width).toBe('100%', 'fullscreen preview should span the modal width');
  expect(style.height).toBe('100%', 'fullscreen preview should span the modal height');
  expect(style.height).not.toBe('80%', 'fullscreen preview should not be capped to 80% height');
});

/// test_markdown_image_shows_loading_until_thumbnail_loads: large markdown images show loading feedback
///
/// Data construction:
///   src = 'https://example.com/large-photo.png'
///   initial thumbLoading = true
///
/// Execution:
///   1. render MarkdownImage → loading indicator visible over thumbnail frame
///   2. fire Image onLoadEnd → component marks thumbnail loading complete
///
/// Expected:
///   - positive: markdown-image-loading exists before load end
///   - negative: markdown-image-loading disappears after onLoadEnd
test('test_markdown_image_shows_loading_until_thumbnail_loads', async () => {
  const { getByTestId, queryByTestId } = render(
    <MarkdownImage
      src="https://example.com/large-photo.png"
      alt="large"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  expect(getByTestId('markdown-image-loading')).toBeTruthy();

  await act(async () => {
    fireEvent(getByTestId('markdown-image-thumb'), 'onLoadEnd');
  });

  expect(queryByTestId('markdown-image-loading')).toBeNull();
});

/// test_markdown_image_hides_loading_after_prefetch_success: Image.onLoadEnd 缺失时仍不能永久 loading
///
/// Data construction:
///   src = 'https://example.com/cached-photo.png'（远端图片 URL）
///   Image.prefetch result = true（RN 已经确认资源可取或已命中缓存）
///   Image.onLoadEnd event = not fired（模拟 iOS/cache 路径未回调）
///
/// Execution:
///   1. mock Image.prefetch → Promise<true>
///   2. render MarkdownImage → thumbLoading 初始为 true，显示 loading overlay
///   3. 等待 prefetch promise resolve → 组件把 thumbLoading 置为 false
///
/// Expected:
///   - positive: Image.prefetch 被传入完整 src，说明使用独立加载信号兜底
///   - positive: markdown-image-thumb 仍存在，说明缩略图没有被错误替换为失败占位
///   - negative: markdown-image-loading 不存在，说明不会因为 onLoadEnd 缺失而一直遮住图片
///   - negative: markdown-image-error 不存在，说明 prefetch 成功不会误报失败
test('test_markdown_image_hides_loading_after_prefetch_success', async () => {
  Image.prefetch = jest.fn().mockResolvedValue(true);

  const { getByTestId, queryByTestId } = render(
    <MarkdownImage
      src="https://example.com/cached-photo.png"
      alt="cached"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  expect(getByTestId('markdown-image-loading')).toBeTruthy();

  await act(async () => {
    await Promise.resolve();
  });

  expect(Image.prefetch).toHaveBeenCalledWith('https://example.com/cached-photo.png');
  expect(getByTestId('markdown-image-thumb')).toBeTruthy();
  expect(queryByTestId('markdown-image-loading')).toBeNull();
  expect(queryByTestId('markdown-image-error')).toBeNull();
});

/// test_markdown_image_prefetch_success_ignores_late_load_start: prefetch 成功后迟到的 onLoadStart 不能恢复 loading
///
/// Data construction:
///   src = 'https://example.com/cache-race.png'（远端图片 URL）
///   Image.prefetch result = true（独立加载信号已确认图片可用）
///   event order = prefetch resolve → Image.onLoadStart → no onLoad/onLoadEnd
///
/// Execution:
///   1. mock Image.prefetch → Promise<true>
///   2. render MarkdownImage → loading 初始显示
///   3. 等待 prefetch resolve → loading 隐藏
///   4. 触发 thumbnail onLoadStart，模拟 RN 事件迟到
///
/// Expected:
///   - positive: markdown-image-thumb 仍存在，说明图片节点没有被移除
///   - negative: markdown-image-loading 仍不存在，说明迟到 onLoadStart 不会恢复永久遮罩
///   - negative: markdown-image-error 不存在，说明该竞态没有被误判为失败
test('test_markdown_image_prefetch_success_ignores_late_load_start', async () => {
  Image.prefetch = jest.fn().mockResolvedValue(true);

  const { getByTestId, queryByTestId } = render(
    <MarkdownImage
      src="https://example.com/cache-race.png"
      alt="cache race"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(queryByTestId('markdown-image-loading')).toBeNull();

  await act(async () => {
    fireEvent(getByTestId('markdown-image-thumb'), 'onLoadStart');
  });

  expect(getByTestId('markdown-image-thumb')).toBeTruthy();
  expect(queryByTestId('markdown-image-loading')).toBeNull();
  expect(queryByTestId('markdown-image-error')).toBeNull();
});

/// test_markdown_image_shows_error_placeholder_on_load_error: triggering onError shows "Image unavailable"
///
/// Data construction:
///   src = 'https://example.com/broken.png' (URL that will fail to load)
///   alt = 'broken'
///
/// Execution:
///   1. render MarkdownImage → thumbnail Image rendered with onError handler
///   2. fire onError event on the Image → setHasError(true)
///   3. component re-renders showing error placeholder instead of Image
///
/// Expected:
///   - after onError: queryByTestId('markdown-image-thumb') is null (Image removed)
///   - after onError: getByTestId('markdown-image-error') is truthy (placeholder shown)
///   - placeholder contains text "Image unavailable"
test('test_markdown_image_shows_error_placeholder_on_load_error', async () => {
  const { getByTestId, queryByTestId, getByText } = render(
    <MarkdownImage
      src="https://example.com/broken.png"
      alt="broken"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  await act(async () => {
    fireEvent(getByTestId('markdown-image-thumb'), 'onError');
  });

  // assertion failure = thumbnail Image still visible after load error
  expect(queryByTestId('markdown-image-thumb')).toBeNull();
  // assertion failure = error placeholder not shown after load error
  expect(getByTestId('markdown-image-error')).toBeTruthy();
  // assertion failure = "Image unavailable" text not rendered in placeholder
  expect(getByText('Image unavailable')).toBeTruthy();
});

/// test_markdown_image_records_release_log_on_load_error: markdown image failures are visible in release logs
///
/// Data construction:
///   src = '/tmp/img.png' (local absolute path converted to /api/v1/files)
///   serverUrl = 'http://localhost:8765', token = 'test-token'
///   probe response status = 401, content-type = application/json
///
/// Execution:
///   1. clearDiagnosticsEntries() resets prior release logs
///   2. render MarkdownImage → src resolves to /api/v1/files?...&token=test-token
///   3. trigger Image onError → component records failure and probes the URL
///
/// Expected:
///   - positive: release logs contain [chat.markdown_image], proving the failure is observable
///   - positive: release logs contain status 401, proving HTTP status is captured
///   - negative: release logs do not contain debug_token，避免调试字段进入发布版
///   - negative: release logs do not contain raw query token，避免泄露 URL token
test('test_markdown_image_records_release_log_on_load_error', async () => {
  await clearDiagnosticsEntries();
  global.fetch = jest.fn().mockResolvedValue({
    status: 401,
    ok: false,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
  }) as typeof fetch;
  const { getByTestId } = render(
    <MarkdownImage src="/tmp/img.png" alt="local" serverUrl={SERVER_URL} token={TOKEN} />,
  );

  await act(async () => {
    fireEvent(getByTestId('markdown-image-thumb'), 'onError');
  });

  await act(async () => {
    await Promise.resolve();
  });

  expect(getDiagnosticsLogText()).toContain(
    '[chat.markdown_image]',
    'markdown image load failure should be recorded in release diagnostics logs',
  );
  expect(getDiagnosticsLogText()).toContain(
    '"status":401',
    'markdown image probe should include HTTP status for release debugging',
  );
  expect(getDiagnosticsLogText()).not.toContain('"debug_token"');
  expect(getDiagnosticsLogText()).not.toContain(
    'token=test-token',
    'release diagnostics logs should redact markdown image token query values',
  );
});

/// test_markdown_image_redacts_direct_url_src_token: direct URL markdown src must also be redacted
///
/// Data construction:
///   src = 'https://example.com/img.png?token=test-token'
///   fetch mock status = 401
///
/// Execution:
///   1. render MarkdownImage with direct URL src containing token
///   2. trigger thumbnail onError
///   3. read diagnostics log text
///
/// Expected:
///   - positive: release logs contain token=[REDACTED]，说明 URL 可用于定位
///   - negative: release logs do not contain token=test-token，说明 src/uri 双字段均脱敏
test('test_markdown_image_redacts_direct_url_src_token', async () => {
  await clearDiagnosticsEntries();
  global.fetch = jest.fn().mockResolvedValue({
    status: 401,
    ok: false,
    headers: { get: () => null },
  }) as typeof fetch;
  const { getByTestId } = render(
    <MarkdownImage
      src="https://example.com/img.png?token=test-token"
      alt="remote"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  await act(async () => {
    fireEvent(getByTestId('markdown-image-thumb'), 'onError');
    await Promise.resolve();
  });

  expect(getDiagnosticsLogText()).toContain('token=[REDACTED]');
  expect(getDiagnosticsLogText()).not.toContain('token=test-token');
});

/// test_markdown_image_dedupes_failure_probe_per_uri: repeated Image onError should not spam release logs
///
/// Data construction:
///   src = 'https://example.com/broken.png'
///   fetch mock status = 404
///
/// Execution:
///   1. render MarkdownImage
///   2. trigger thumbnail onError twice before unmount
///   3. wait for pending probe task
///
/// Expected:
///   - positive: fetch called once，说明同一 URI 只 probe 一次
///   - negative: fetch not called twice，避免 release logs 和网络请求被重复刷屏
test('test_markdown_image_dedupes_failure_probe_per_uri', async () => {
  await clearDiagnosticsEntries();
  global.fetch = jest.fn().mockResolvedValue({
    status: 404,
    ok: false,
    headers: { get: () => null },
  }) as typeof fetch;
  const { getByTestId } = render(
    <MarkdownImage
      src="https://example.com/broken.png"
      alt="broken"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  await act(async () => {
    fireEvent(getByTestId('markdown-image-thumb'), 'onError');
    fireEvent(getByTestId('markdown-image-thumb'), 'onError');
    await Promise.resolve();
  });

  expect(global.fetch).toHaveBeenCalledTimes(1);
});

/// test_markdown_image_fullscreen_error_does_not_replace_thumbnail: fullscreen failures should not poison inline thumbnail
///
/// Data construction:
///   src = 'https://example.com/photo.png'
///   thumbnail already loaded successfully
///   fullscreen Image then fires onError
///
/// Execution:
///   1. render MarkdownImage
///   2. fire thumbnail onLoadEnd → loading hidden，thumbnail considered loaded
///   3. press thumbnail → Modal opens
///   4. fire fullscreen Image onError
///
/// Expected:
///   - positive: inline thumbnail still exists，用户仍能看到聊天里的缩略图
///   - positive: fullscreen error placeholder exists in Modal
///   - negative: markdown-image-error 不存在，说明没有把整体组件切到失败占位
test('test_markdown_image_fullscreen_error_does_not_replace_thumbnail', async () => {
  const { getByTestId, queryByTestId } = render(
    <MarkdownImage
      src="https://example.com/photo.png"
      alt="photo"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  await act(async () => {
    fireEvent(getByTestId('markdown-image-thumb'), 'onLoadEnd');
  });
  await act(async () => {
    fireEvent.press(getByTestId('markdown-image-thumb-press'));
  });
  await act(async () => {
    fireEvent(getByTestId('markdown-image-fullscreen'), 'onError');
  });

  expect(getByTestId('markdown-image-thumb')).toBeTruthy();
  expect(getByTestId('markdown-image-fullscreen-error')).toBeTruthy();
  expect(queryByTestId('markdown-image-error')).toBeNull();
});

/// test_markdown_image_closes_modal_on_x_press: pressing X button closes modal
///
/// Data construction:
///   src = 'https://example.com/photo.png'
///   alt = 'photo'
///
/// Execution:
///   1. render MarkdownImage → press thumbnail to open modal
///   2. modal is visible → testID="markdown-image-close-btn" is accessible
///   3. press close button → setPreviewVisible(false) → modal hidden
///
/// Expected:
///   - after opening: modal is visible
///   - after pressing X: queryByTestId('markdown-image-modal') is null (modal closed)
test('test_markdown_image_closes_modal_on_x_press', async () => {
  const { getByTestId, queryByTestId } = render(
    <MarkdownImage
      src="https://example.com/photo.png"
      alt="photo"
      serverUrl={SERVER_URL}
      token={TOKEN}
    />,
  );

  // open modal first
  await act(async () => {
    fireEvent.press(getByTestId('markdown-image-thumb-press'));
  });

  // assertion failure = modal did not open, cannot test close behavior
  expect(getByTestId('markdown-image-modal')).toBeTruthy();

  await act(async () => {
    fireEvent.press(getByTestId('markdown-image-close-btn'));
  });

  // assertion failure = modal did not close after pressing X button
  expect(queryByTestId('markdown-image-modal')).toBeNull();
});
