import { render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { brandColors, brandRgba } from '@/theme/brandRefresh';
import ChatHeader from './ChatHeader';

/// Chat header target: top chrome should match the refreshed Codex Runner prototype.
///
/// Data setup:
///   title         = "Codex Runner" from the active agent name.
///   status badge  = Running, lime-soft background, green status dot.
///   endpoint row  = alanmacbook-pro.local + Connected with a cyan dot.
///   side buttons  = 34pt circles after applying the requested 30% size reduction.
///
/// Execution:
///   1. Render ChatHeader with the prototype title, status, and connection row.
///   2. Inspect the fixed layout styles on the nav, side buttons, and metadata rows.
///   3. Inspect visible text nodes for title, status, endpoint, and connection.
///
/// Expected:
///   - Positive: title/status/endpoint/connection all render in the header.
///   - Positive: nav is tall enough for the three centered rows.
///   - Positive: both side controls are 34pt white circles.
///   - Negative: old single-line divider chrome is absent.
it('renders the refreshed Codex Runner header chrome', () => {
  const { getByTestId, getByText } = render(
    <ChatHeader
      title="Codex Runner"
      badge={{
        label: 'Running',
        bg: brandRgba.limeSoft,
        dot: brandColors.successCompat,
        fg: brandColors.successCompat,
      }}
      endpointName="alanmacbook-pro.local"
      connectionLabel="Connected"
      connectionDot={brandColors.cyan}
      connectionTextColor={brandColors.cyan}
      onBack={jest.fn()}
      onMore={jest.fn()}
    />,
  );

  const titleNode = getByText('Codex Runner');
  const statusNode = getByTestId('status-badge-text');
  const endpointNode = getByText('alanmacbook-pro.local');
  const connectionNode = getByText('Connected');

  expect({
    actual: Boolean(titleNode),
    reason: 'agent title should stay centered as the primary header label',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: statusNode.props.children,
    reason: 'status badge should use prototype title case, not the old all-caps label',
  }).toEqual({ actual: 'Running', reason: expect.any(String) });
  expect({
    actual: Boolean(endpointNode),
    reason: 'endpoint hostname should render below the status pill',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: Boolean(connectionNode),
    reason: 'connection state should render in the endpoint metadata row',
  }).toEqual({ actual: true, reason: expect.any(String) });

  const titleStyle = StyleSheet.flatten(titleNode.props.style);
  expect({
    actual: titleStyle.fontSize,
    reason: 'title font should be 30% smaller than the previous 22pt style',
  }).toEqual({ actual: 15, reason: expect.any(String) });

  const statusStyle = StyleSheet.flatten(statusNode.props.style);
  expect({
    actual: statusStyle.fontSize,
    reason: 'status badge text should be 30% smaller than the previous 13pt style',
  }).toEqual({ actual: 9, reason: expect.any(String) });

  const endpointStyle = StyleSheet.flatten(endpointNode.props.style);
  expect({
    actual: endpointStyle.fontSize,
    reason: 'endpoint text should be 30% smaller than the previous 13pt style',
  }).toEqual({ actual: 9, reason: expect.any(String) });

  const connectionStyle = StyleSheet.flatten(connectionNode.props.style);
  expect({
    actual: connectionStyle.fontSize,
    reason: 'connection text should match the reduced endpoint text size',
  }).toEqual({ actual: 9, reason: expect.any(String) });

  const navStyle = StyleSheet.flatten(getByTestId('chat-header-nav').props.style);
  expect({
    actual: navStyle.height,
    reason: 'nav height must reserve room for title, status pill, and endpoint row',
  }).toEqual({ actual: 104, reason: expect.any(String) });
  expect({
    actual: navStyle.borderBottomWidth,
    reason: 'refreshed prototype has no old bottom divider line',
  }).toEqual({ actual: undefined, reason: expect.any(String) });

  const backStyle = StyleSheet.flatten(getByTestId('chat-header-back-button').props.style);
  expect({
    actual: backStyle.width,
    reason: 'back button should be 30% smaller than the previous 48pt circle',
  }).toEqual({ actual: 34, reason: expect.any(String) });
  expect({
    actual: backStyle.height,
    reason: 'back button height should match its circular width',
  }).toEqual({ actual: 34, reason: expect.any(String) });
  expect({
    actual: backStyle.borderRadius,
    reason: 'back button radius should make the 34pt control circular',
  }).toEqual({ actual: 17, reason: expect.any(String) });
  expect({
    actual: backStyle.backgroundColor,
    reason: 'back button surface should be the raised white circle from the prototype',
  }).toEqual({ actual: brandColors.white, reason: expect.any(String) });

  const moreStyle = StyleSheet.flatten(getByTestId('chat-header-more-button').props.style);
  expect({
    actual: moreStyle.width,
    reason: 'more button should mirror the reduced 34pt circular back control',
  }).toEqual({ actual: 34, reason: expect.any(String) });
  expect({
    actual: moreStyle.height,
    reason: 'more button height should match its circular width',
  }).toEqual({ actual: 34, reason: expect.any(String) });
  expect({
    actual: moreStyle.borderRadius,
    reason: 'more button radius should make the 34pt control circular',
  }).toEqual({ actual: 17, reason: expect.any(String) });
  expect({
    actual: moreStyle.backgroundColor,
    reason: 'more button surface should match the raised white prototype circle',
  }).toEqual({ actual: brandColors.white, reason: expect.any(String) });
});
