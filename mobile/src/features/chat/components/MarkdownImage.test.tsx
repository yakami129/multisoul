import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { MarkdownImage } from './MarkdownImage';

const SERVER_URL = 'http://localhost:8765';
const TOKEN = 'test-token';

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
