# MultiSoul Privacy Policy

Last updated: June 7, 2026

## Overview

MultiSoul is a mobile console for local AI agents. It is designed so that your app data stays on your device and on the computer where you run `msctl`. MultiSoul does not operate a central hosted backend for your agent conversations.

This policy explains what data the MultiSoul app and the companion `msctl` service handle, how that data is used, and what third-party services may be involved when you enable specific features.

## Information We Handle

### Data Stored on Your Device

The MultiSoul app stores information needed to connect to and display your local agents, including:

- Saved endpoint labels and server URLs
- Bearer tokens for endpoints you add
- App settings
- Inbox and notification cache
- Agent, conversation, task, idea, and spec metadata cached for offline or fast loading
- Local diagnostics logs used to troubleshoot app behavior

This data is stored locally on your device using the app's local storage and SQLite database.

### Data Stored on Your Computer

The companion `msctl` service stores its data on the computer where you run it, normally under `~/.config/msctl/`. This may include:

- Registered agents and workspace paths
- Conversation history, messages, tool calls, and tool results
- Task status records
- Files or attachments you send to your local agent
- Push notification tokens registered by your devices

We do not operate or access this local database.

### Messages, Code, and Attachments

When you send messages, code snippets, images, audio, or other attachments through MultiSoul, that content is sent to the `msctl` endpoint you configured. The content may then be processed by the local agent runtime or AI provider tools you choose to run, such as Claude Code, Codex, Cursor Agent CLI, or another configured runtime.

MultiSoul itself does not send your conversation content to a central MultiSoul server.

### Push Notifications

If you grant notification permission, the app asks Apple's notification system and Expo's push notification service for a push token. The app stores that token on your device and registers it with your configured `msctl` endpoints so your local service can notify you about pending questions, task completion, or failures.

Notification delivery may involve Apple Push Notification service and Expo Push Service. Notification payloads may include the title, body, and navigation metadata needed to display and open the relevant item in the app.

You can disable notifications in iOS settings at any time.

### Relay and Tunnel Connections

MultiSoul can connect to `msctl` through connection methods you choose, such as:

- A direct local or private network URL
- Cloudflare Tunnel relay mode
- Tailscale or Tailscale Funnel

When relay or tunnel features are used, the relevant service provider may process connection metadata needed to route traffic. For example, relay mode may publish a temporary tunnel URL and status so your phone can discover your local `msctl` service. These providers have their own privacy and security practices.

## Permissions

MultiSoul may request the following iOS permissions:

- **Notifications**: to alert you when an agent needs attention or a task completes.
- **Camera**: to scan pairing QR codes and, when you choose, capture images for agent messages.
- **Photo Library**: to attach images you select to agent messages or ideas.
- **Microphone**: to record or send audio to your agents when audio features are used.

These permissions are optional and are used only for the feature you choose to use.

## Analytics and Advertising

MultiSoul does not include third-party advertising SDKs and does not use third-party analytics services in the app.

## How We Use Information

MultiSoul uses the information described above to:

- Connect your phone to your configured local `msctl` endpoints
- Display agents, conversations, activity, inbox items, ideas, and specs
- Send your commands, messages, and attachments to the endpoint you selected
- Deliver local-agent notifications through Apple and Expo push notification services
- Troubleshoot app behavior through local diagnostics logs

## What We Do Not Do

MultiSoul does not:

- Sell your personal information
- Operate a central hosted database of your agent conversations
- Use advertising tracking
- Use third-party analytics in the app
- Read files from your computer unless you explicitly send or expose them through your configured `msctl` workflow

## Data Retention and Deletion

Data stored in the MultiSoul app remains on your device until you remove endpoints, clear app data, or uninstall the app.

Data stored by `msctl` remains on the computer where you run `msctl` until you delete it using the app, the CLI, or your operating system's file tools.

Push tokens may be stored by your configured `msctl` endpoints until they are removed, replaced, or become invalid.

## Security

MultiSoul uses bearer tokens to authenticate requests to protected `msctl` endpoints. You should treat endpoint tokens and pairing links as secrets. Only connect to endpoints and relay services you trust.

Because MultiSoul is designed to control local agent runtimes, the security of your setup also depends on the machine running `msctl`, the agent runtimes you install, and the AI providers or developer tools those runtimes use.

## Third-Party Services

Depending on the features you use, MultiSoul may rely on:

- Apple App Store, iOS, and Apple Push Notification service
- Expo Push Service for notification delivery
- Cloudflare Tunnel or Cloudflare Workers KV if you use relay mode
- Tailscale or Tailscale Funnel if you choose those connection modes
- AI agent runtimes and providers that you configure outside of MultiSoul
- GitHub if you contact us through GitHub Issues

Each third-party service is governed by its own terms and privacy policy.

## Your Choices

You can:

- Choose which `msctl` endpoints to add or remove
- Revoke iOS permissions such as Notifications, Camera, Photos, or Microphone
- Delete local app data by removing endpoints or uninstalling the app
- Delete local `msctl` data from the computer where you run it
- Review the open-source code at https://github.com/yakami129/multisoul

## Children's Privacy

MultiSoul is intended for developers and is not directed to children under 13. We do not knowingly collect personal information from children.

## Changes to This Policy

We may update this policy as MultiSoul changes. Material updates will be reflected by changing the "Last updated" date above.

## Contact

For privacy questions or requests, open an issue at:

https://github.com/yakami129/multisoul/issues
