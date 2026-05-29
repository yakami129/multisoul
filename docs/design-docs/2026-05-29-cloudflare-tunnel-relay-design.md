# Cloudflare Tunnel Relay Design

**Date:** 2026-05-29  
**Status:** Implemented  
**Scope:** Auto Tunnel mode for mobile app to discover `msctl serve` via Cloudflare Workers KV

---

## 1. Problem

Users running `msctl serve` on their local machine need a way for the mobile app to discover the server's public URL without manual configuration. The challenge:

- Local machine may not have a static public IP
- Tailscale Funnel requires manual setup and domain configuration
- Users want a zero-config "Auto Tunnel" mode that just works

## 2. Solution Overview

**Cloudflare Tunnel Relay** provides automatic discovery via:

1. **CLI relay mode** (`msctl serve --relay`):
   - Automatically downloads `cloudflared` binary
   - Launches a Cloudflare Tunnel to expose `msctl serve`
   - Obtains a temporary public URL (e.g., `https://abc-def-ghi.trycloudflare.com`)
   - Reports the URL to a Cloudflare Workers KV store

2. **Mobile polling** (Auto Tunnel mode):
   - User enters their `msctl` Bearer token
   - Mobile app polls a Workers endpoint every 10 seconds
   - Workers endpoint queries KV for the tunnel URL
   - Once found, mobile connects directly to the tunnel URL

3. **Cloudflare Workers KV** (deployment manual):
   - Stores mapping: `ms_v2_<token>` → `{ status, tunnel_url, updated_at }`
   - Expires entries after 5 minutes of inactivity
   - Accessed via `GET /tunnel/<token>` endpoint

---

## 3. Architecture

### 3.1 CLI Relay Flow

```
┌─────────────────────────────────────────────────────────────┐
│ msctl serve --relay                                         │
├─────────────────────────────────────────────────────────────┤
│ 1. Download cloudflared (if missing)                        │
│    → ~/.config/msctl/cloudflared                            │
│                                                              │
│ 2. Launch tunnel                                            │
│    → cloudflared tunnel --url http://localhost:8080         │
│    → Obtain: https://abc-def-ghi.trycloudflare.com          │
│                                                              │
│ 3. Report to KV every 30 seconds                            │
│    → POST https://worker.example.com/tunnel/<token>         │
│    → Body: { status: "active", tunnel_url: "..." }          │
│                                                              │
│ 4. Heartbeat loop (5 min timeout)                           │
│    → If no heartbeat, KV entry expires                      │
└─────────────────────────────────────────────────────────────┘
```

**Key files:**
- `cli/src/commands/serve.rs`: `--relay` flag parsing
- `cli/src/serve/tunnel.rs`: Tunnel launch and KV reporting
- `cli/src/serve/cloudflared.rs`: Binary download and caching

### 3.2 Mobile Polling Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Mobile: Auto Tunnel Mode                                    │
├─────────────────────────────────────────────────────────────┤
│ 1. User enters Bearer token (ms_v2_...)                     │
│                                                              │
│ 2. Poll loop (10s interval, 5 min timeout)                  │
│    → GET https://worker.example.com/tunnel/<token>          │
│    → Check response.status                                  │
│                                                              │
│ 3. On success (status: "active")                            │
│    → Extract tunnel_url                                     │
│    → Save to settings                                       │
│    → Connect to tunnel_url                                  │
│                                                              │
│ 4. On timeout or error                                      │
│    → Show alert: "Timed out waiting for msctl serve..."     │
│    → User can retry or switch to Custom Server mode         │
└─────────────────────────────────────────────────────────────┘
```

**Key files:**
- `mobile/src/features/settings/services/tunnelService.ts`: Polling logic
- `mobile/src/features/settings/components/SettingsForm.tsx`: UI mode toggle
- `mobile/src/store/settingsStore.ts`: Settings persistence

### 3.3 Cloudflare Workers KV Schema

**Endpoint:** `GET /tunnel/<token>`

**Response (active):**
```json
{
  "status": "active",
  "tunnel_url": "https://abc-def-ghi.trycloudflare.com",
  "updated_at": "2026-05-29T12:34:56Z"
}
```

**Response (not found):**
```json
{
  "status": "not_found"
}
```

**KV Key:** `ms_v2_<token>` (40-char hex token)  
**TTL:** 5 minutes (auto-expire if no heartbeat)

---

## 4. Implementation Details

### 4.1 CLI Changes

**New flag:**
```bash
msctl serve --relay
```

**Behavior:**
- Validates relay worker URL is configured (not `PLACEHOLDER`)
- Downloads `cloudflared` if missing
- Launches tunnel with `--url http://localhost:8080`
- Extracts tunnel URL from `cloudflared` output
- Reports to KV every 30 seconds
- Logs tunnel URL for user to copy

**Error handling:**
- If `cloudflared` download fails → error and exit
- If tunnel launch fails → error and exit
- If KV reporting fails → warn but continue (tunnel still works locally)

### 4.2 Mobile Changes

**Settings extension:**
```typescript
interface Settings {
  connectionMode: 'auto' | 'custom';
  relayToken: string;           // Bearer token for auto mode
  relayWorkerUrl: string;        // Cloudflare Workers endpoint
  serverUrl: string;             // Custom server URL
  apiKey: string;                // Custom server API key
}
```

**Tunnel service:**
- `fetchTunnelUrl(workerUrl, token, signal?)`: Single fetch attempt
- `pollTunnelUrl(workerUrl, token, intervalMs, timeoutMs)`: Poll loop with abort support

**UI:**
- Toggle between "Auto Tunnel" and "Custom Server" modes
- Auto mode shows Bearer token input
- Custom mode shows Server URL + API Key inputs
- Save button triggers polling (with loading state)
- Abort on unmount or re-press

### 4.3 Cancellation & Cleanup

**Mobile:**
- `AbortController` for fetch cancellation
- Cleanup on component unmount
- Cleanup on re-press (cancel in-flight poll)
- Explicit error message for user-initiated cancellation

**CLI:**
- `cloudflared` process cleanup on exit
- Graceful shutdown of tunnel on SIGTERM/SIGINT

---

## 5. Security Considerations

### 5.1 Token Format

- Bearer tokens are 40-char hex (e.g., `ms_v2_abc123...`)
- Tokens are user-generated and stored locally
- No token validation on mobile (Workers endpoint validates)
- Tokens are **not** hardcoded in code (checked by pre-commit hook)

### 5.2 HTTPS & TLS

- All communication is HTTPS (Cloudflare Tunnel provides TLS)
- Mobile connects to tunnel URL (Cloudflare-issued certificate)
- No certificate pinning (relies on system trust store)

### 5.3 KV Access Control

- Workers endpoint should validate token format before querying KV
- KV entries auto-expire (5 min TTL)
- No sensitive data in KV (only tunnel URL and status)

---

## 6. Testing

### 6.1 Unit Tests

**CLI:**
- `test_relay_flag_parsing`: Verify `--relay` flag is recognized
- `test_cloudflared_download`: Mock download and verify caching
- `test_tunnel_url_extraction`: Parse `cloudflared` output
- `test_kv_reporting`: Mock HTTP POST to Workers endpoint

**Mobile:**
- `test_fetch_tunnel_url`: Mock fetch, verify parsing
- `test_poll_tunnel_url`: Mock fetch loop, verify polling
- `test_poll_abort`: Verify AbortController cancellation
- `test_settings_form_auto_mode`: Verify UI mode toggle and polling

### 6.2 Integration Tests

**End-to-end (manual):**
1. Start `msctl serve --relay`
2. Verify tunnel URL is logged
3. Verify KV entry is created
4. Start mobile app
5. Switch to Auto Tunnel mode
6. Enter Bearer token
7. Verify polling succeeds and connects

---

## 7. Deployment Checklist

### 7.1 Cloudflare Workers Setup (Manual)

- [ ] Create Cloudflare Workers account
- [ ] Create KV namespace: `multisoul-tunnel`
- [ ] Deploy Workers script with `/tunnel/<token>` endpoint
- [ ] Update `PLACEHOLDER` URL in code to actual Workers domain
- [ ] Test endpoint manually: `curl https://worker.example.com/tunnel/ms_v2_test`

### 7.2 Code Deployment

- [ ] Merge `feat+cloudflare-tunnel` branch to `main`
- [ ] Tag release (e.g., `v0.2.0`)
- [ ] Build and publish CLI binary
- [ ] Build and submit iOS app to App Store
- [ ] Update README with `msctl serve --relay` documentation

---

## 8. Future Improvements

1. **Persistent tunnel URLs**: Option to use custom domain instead of temporary URL
2. **Multiple devices**: Support multiple mobile devices polling same token
3. **Tunnel status UI**: Show tunnel status in CLI (active/inactive/error)
4. **Fallback modes**: Automatic fallback to Tailscale Funnel if tunnel fails
5. **Token rotation**: Periodic token refresh for security

---

## 9. References

- Cloudflare Tunnel docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
- Cloudflare Workers KV: https://developers.cloudflare.com/workers/runtime-apis/kv/
- `cloudflared` releases: https://github.com/cloudflare/cloudflared/releases
