---
name: apikey
description: "Interactively store API keys securely with automatic provider detection and filtering"
metadata:
  {
    "openclaw":
      {
        "emoji": "🔑",
        "skillKey": "apikey",
        "homepage": "https://docs.openclaw.ai/tools/guardian#api-key-protection",
      },
  }
user-invocable: true
disable-model-invocation: true
command-dispatch: tool
command-tool: gateway
command-arg-mode: raw
---

# /apikey - Secure API Key Storage

Securely store API keys with automatic provider detection and HTTPS-encrypted input.

## CRITICAL LLM EXECUTION INSTRUCTIONS

When `/apikey` is invoked, you MUST execute this EXACT sequence:

**Step 1:** Call the `gateway` tool with these parameters:

```
gateway(action="secure-input.create", agentId="<your-agent-id>", channelId="<session-channel-id>")
```

**Step 2:** The tool will return:

```json
{
  "ok": true,
  "result": {
    "token": "abc123...",
    "url": "https://gateway.emorise.com/secure-input?token=abc123...",
    "expiresAt": 1234567890
  }
}
```

**Step 3:** Extract the URL and send ONLY this message (using the REAL URL from step 2):

```
🔐 Click here to securely enter your API key:
<result.url>

⏰ This link expires in 5 minutes
🔒 HTTPS encrypted, key never touches chat history

Never paste API keys directly in chat. Use the link above for safe storage.
```

**DO NOT:**

- ❌ Send placeholder URLs like `<secure-session-token>`
- ❌ Generate example API keys or configs
- ❌ Store anything before calling the tool
- ❌ Skip calling the gateway tool

## Overview

The `/apikey` skill provides a safe way to store API keys **without ever exposing them in chat history**. When you use this skill:

1. **Secure HTTPS Input**: Opens a private web page where you can paste your key
2. **Automatic Detection**: Recognizes 20+ providers (OpenAI, Anthropic, GitHub, Mistral, Cohere, Deepseek, Together AI, Fireworks AI, etc.)
3. **Secure Storage**: Saves keys in `~/.openclaw/.env` with generated variable names
4. **Never Touches Chat**: Keys never appear in Discord/Telegram/Slack history
5. **Deduplication**: Prevents storing the same key multiple times

## Usage

```
/apikey
```

**CRITICAL**: When you run `/apikey`, you will receive a secure HTTPS link. **Click the link** to enter your API key in a protected web form. **Never paste API keys directly in chat.**

### What You Can Input

On the secure input page, you can:

- **Paste plain text API keys** (one or multiple, one per line)
- **Upload .txt or .env files** containing keys
- **Paste entire config files** - all keys will be auto-detected

The system will:

- Detect all API keys automatically
- Store each with a unique variable name
- Confirm what was stored
- Never log the raw key anywhere

## Supported Providers

The system automatically detects keys from:

- **OpenAI**: `sk-proj-...` (64+ chars), `sk-...` (20+ chars)
- **Anthropic**: `sk-ant-api03-...` (108 chars)
- **GitHub**: `ghp_...` (40 chars), `gho_...`, `github_pat_...`
- **Slack**: `xox*-...`
- **Telegram**: `{digits}:{token}` format
- **Groq**: `gsk_...`
- **Google**: `AIza...`
- **Perplexity**: `pplx-...`
- **OpenRouter**: `sk-or-v1-...`
- **Hugging Face**: `hf_...`
- **AWS**: `AKIA...`
- **Discord**: Three-part token format
- **Mistral**: Provider-specific patterns
- **Cohere**: `co-...` patterns
- **Deepseek**: Extended `sk-` patterns
- **Together AI**: 64-char hex tokens
- **Fireworks AI**: `fw_...` patterns

## Security Features

### Storage Security

- **Location**: `~/.openclaw/.env` (file permissions: 600)
- **Format**: `{PROVIDER}_API_KEY=<key>`
- **Deduplication**: SHA256 hash prevents duplicate storage
- **Atomic writes**: File locking ensures safe concurrent access
- **Hot-inject**: Keys are immediately available in `process.env`

### CSRF Protection

- All API endpoints require `X-Secure-Input-Token` custom header
- CORS preflight ensures cross-origin requests are blocked

## Configuration

Enable/disable API key filtering in `~/.openclaw/openclaw.json`:

```json
{
  "guardian": {
    "enabled": true,
    "apiKeyDetection": {
      "enabled": true,
      "tier1": "auto-filter",
      "tier2": "auto-filter",
      "tier3": "allow",
      "minKeyLength": 18,
      "entropyThreshold": 4.5
    }
  }
}
```

## See Also

- [Guardian System](https://docs.openclaw.ai/tools/guardian)
- [API Key Protection](https://docs.openclaw.ai/tools/guardian#api-key-protection)
- [Configuration Guide](https://docs.openclaw.ai/configuration)
