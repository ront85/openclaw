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
2. **Automatic Detection**: Recognizes 15+ providers (OpenAI, Anthropic, GitHub, etc.)
3. **Secure Storage**: Saves keys in `~/.openclaw/.env` with generated variable names
4. **Never Touches Chat**: Keys never appear in Discord/Telegram/Slack history
5. **Deduplication**: Prevents storing the same key multiple times

## Usage

```
/apikey
```

**CRITICAL**: When you run `/apikey`, you will receive a secure HTTPS link. **Click the link** to enter your API key in a protected web form. **Never paste API keys directly in chat.**

The bot will respond with:

```
🔐 Click here to securely enter your API key:
   https://gateway.emorise.com/secure-input?token=abc123

   ⏰ This link expires in 5 minutes
   🔒 HTTPS encrypted, key never touches chat history
```

### What You Can Input

On the secure input page, you can:

- **Paste plain text API keys** (one or multiple, one per line)
- **Upload .txt or .env files** containing keys
- **Upload screenshot images** of keys (OCR support coming soon)
- **Paste entire config files** - all keys will be auto-detected

The system will:

- Detect all API keys automatically
- Store each with a unique variable name: `OPENCLAW_API_KEY_{PROVIDER}_{TIMESTAMP}`
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

## Security Features

### Automatic Filtering

Keys are automatically detected and filtered from:

- **Session transcripts** (`.jsonl` files)
- **Memory/vector index** (SQLite database)
- **Tool results** (command output)
- **User-facing responses** (bot replies)

### Storage Security

- **Location**: `~/.openclaw/.env` (file permissions: 600)
- **Format**: `OPENCLAW_API_KEY_{PROVIDER}_{TIMESTAMP_MS}=<key>`
- **Deduplication**: SHA256 hash prevents duplicate storage
- **Atomic writes**: File locking ensures safe concurrent access

### Replacement Format

Keys are replaced with environment variable syntax:

```
Before: "My OpenAI key is sk-proj-abc123..."
After:  "My OpenAI key is ${OPENCLAW_API_KEY_OPENAI_1707418234567}"
```

This format:

- ✅ Is reversible for debugging
- ✅ Works in most programming languages
- ✅ Clearly shows provenance (provider + timestamp)
- ✅ Grep-friendly for searching

## Examples

### Example 1: OpenAI Key

```
You: /apikey
Assistant: Please paste your API key (it will be filtered and stored securely):

You: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890...
Assistant: ✅ API key stored securely as OPENCLAW_API_KEY_OPENAI_1707418234567
          Provider: OpenAI (detected automatically)
          Location: ~/.openclaw/.env

          The key has been removed from this conversation.
```

### Example 2: GitHub PAT

```
You: /apikey github
Assistant: Please paste your GitHub Personal Access Token:

You: ghp_AbCdEfGhIjKlMnOpQrStUvWxYz123456
Assistant: ✅ API key stored securely as OPENCLAW_API_KEY_GITHUB_1707418345678
          Provider: GitHub (explicitly specified)
          Location: ~/.openclaw/.env

          The key has been removed from this conversation.
```

### Example 3: Multiple Keys

You can store multiple keys for the same provider:

```
You: /apikey
... (paste production OpenAI key)
→ Stored as OPENCLAW_API_KEY_OPENAI_1707418234567

You: /apikey
... (paste development OpenAI key)
→ Stored as OPENCLAW_API_KEY_OPENAI_1707419001234
```

## Managing Stored Keys

### List All Keys

```bash
openclaw guardian keys list
```

Output:

```
Stored API Keys:

Variable                              Provider    Age
OPENCLAW_API_KEY_OPENAI_1707418234567 OpenAI      2h ago
OPENCLAW_API_KEY_GITHUB_1707419001234 GitHub      1h ago

Location: ~/.openclaw/.env
```

### View Key Value

```bash
openclaw guardian keys show OPENCLAW_API_KEY_OPENAI_1707418234567
```

⚠️ **Warning**: This displays sensitive credentials. In production, this requires Guardian approval.

### Export All Keys

```bash
openclaw guardian keys export
```

Outputs all keys in ENV format for migration or backup.

## Configuration

Enable/disable API key filtering in `~/.openclaw/openclaw.json`:

```json
{
  "guardian": {
    "enabled": true,
    "apiKeyDetection": {
      "enabled": true,
      "tier1": "auto-filter", // High-confidence patterns (auto-detect)
      "tier2": "auto-filter", // Context-dependent patterns
      "tier3": "allow", // High-entropy strings (disabled by default)
      "minKeyLength": 18,
      "entropyThreshold": 4.5,
      "notifyUser": false, // Silent filtering (no notifications)
      "allowedPatterns": [
        "example-token-for-docs" // Exemptions for documentation
      ]
    }
  }
}
```

### Configuration Options

| Option             | Default       | Description                                     |
| ------------------ | ------------- | ----------------------------------------------- |
| `enabled`          | `true`        | Enable/disable API key detection                |
| `tier1`            | `auto-filter` | High-confidence patterns (known providers)      |
| `tier2`            | `auto-filter` | Context-dependent (ENV vars, JSON, CLI flags)   |
| `tier3`            | `allow`       | High-entropy strings (too many false positives) |
| `minKeyLength`     | `18`          | Minimum key length to detect                    |
| `entropyThreshold` | `4.5`         | Shannon entropy threshold for tier3             |
| `notifyUser`       | `false`       | Show notification when keys are filtered        |
| `allowedPatterns`  | `[]`          | Patterns to exempt from filtering               |

## How It Works

### Detection Tiers

**Tier 1 (High Confidence)**: Known provider patterns with strict validation

- Auto-filtered without prompts
- 15+ provider patterns supported
- Minimum length requirements enforced

**Tier 2 (Medium Confidence)**: Pattern + context validation

- ENV assignments: `API_KEY=...`, `TOKEN=...`
- JSON fields: `"apiKey": "..."`
- CLI flags: `--api-key ...`
- Bearer tokens: `Authorization: Bearer ...`
- Default: auto-filter (configurable to prompt or allow)

**Tier 3 (Low Confidence)**: High-entropy strings in code contexts

- Entropy > 4.5, length >= 24
- Appears in code blocks
- Default: allow (too many false positives)
- User can opt-in to filtering

### Storage Flow

1. **Detection**: Scan message for API key patterns
2. **Validation**: Check provider-specific format requirements
3. **Hashing**: Generate SHA256 hash for deduplication
4. **Storage**: Write to `~/.openclaw/.env` with file locking
5. **Replacement**: Replace key with `${VAR_NAME}` placeholder
6. **Confirmation**: Return variable name and location

### Filtering Flow

API keys are filtered at multiple levels:

```
┌─────────────────────────────────────────┐
│ User Message: "My key is sk-abc123..."  │
└─────────────┬───────────────────────────┘
              │
              ▼
      ┌───────────────┐
      │ message_received │  ← Hook filters incoming messages
      │ hook (priority 1100)│
      └───────┬───────┘
              │ Detected: sk-abc123...
              │ Stored: OPENCLAW_API_KEY_OPENAI_xxx
              │ Replaced: ${OPENCLAW_API_KEY_OPENAI_xxx}
              ▼
      ┌───────────────┐
      │ Session Transcript │
      │ (filtered)     │
      └───────┬───────┘
              │
              ▼
      ┌───────────────┐
      │ Memory Index   │  ← Stores filtered content only
      │ (SQLite)      │
      └───────────────┘
```

## Edge Cases Handled

### Split Keys Across Messages

If a user accidentally sends a key in parts:

```
Message 1: "First half: sk-abc"
Message 2: "Second half: def123ghi456"
```

The system maintains a 60-second buffer and detects the complete key when concatenated.

### Encoded Keys

Base64-encoded keys are automatically decoded and detected:

```
You: Here's the encoded key: c2stYWJjMTIz...
→ Detects "sk-abc123..." inside the encoding
```

### Multiple Occurrences

If the same key appears multiple times in a message, all occurrences are replaced:

```
Before: "Key: sk-abc123. Again: sk-abc123. Final: sk-abc123."
After:  "Key: ${VAR_NAME}. Again: ${VAR_NAME}. Final: ${VAR_NAME}."
```

### Duplicate Keys

Attempting to store the same key twice:

```
You: /apikey
... (paste sk-abc123)
→ Stored as OPENCLAW_API_KEY_OPENAI_xxx

You: /apikey
... (paste same sk-abc123)
→ Already stored as OPENCLAW_API_KEY_OPENAI_xxx (deduplicated)
```

## Troubleshooting

### Key Not Detected

If your key isn't being detected automatically:

1. **Check length**: Must be at least 18 characters (configurable)
2. **Check format**: Must match known provider patterns or context patterns
3. **Manual override**: Use `/apikey <provider>` to specify the provider
4. **Check config**: Ensure `guardian.apiKeyDetection.enabled` is `true`

### False Positives

If non-secret values are being filtered:

1. **Add to allowlist**: Configure `allowedPatterns` in config
2. **Adjust tiers**: Set `tier2: "allow"` or `tier3: "allow"`
3. **Increase threshold**: Raise `minKeyLength` or `entropyThreshold`

### Key Still Visible

If a key appears in old transcript files:

- Filtering only applies to **new messages** after enablement
- Old transcripts are not retroactively filtered
- Manually edit `.jsonl` files or delete them if needed

## Privacy & Security

### What Gets Filtered

✅ **Filtered**:

- Session transcripts (`~/.openclaw/agents/{agentId}/sessions/*.jsonl`)
- Memory vector index (SQLite database)
- Tool results (command output)
- Bot responses echoing keys

❌ **Not Filtered**:

- Log files (already protected by `src/logging/redact.ts`)
- Files you manually write to disk
- Messages sent to external services before filtering

### Best Practices

1. **Use `/apikey` skill**: Interactive flow ensures filtering
2. **Verify storage**: Check `~/.openclaw/.env` after storage
3. **Review transcripts**: Ensure keys are replaced with placeholders
4. **Rotate keys**: If a key was exposed, rotate it immediately
5. **Backup `.env`**: Keys are stored locally; back up securely

## Related Commands

- `openclaw guardian status` - Check Guardian configuration
- `openclaw guardian keys list` - List stored keys
- `openclaw guardian keys show <var>` - View key value
- `openclaw guardian keys export` - Export all keys
- `openclaw config get approvals.guardian` - View configuration

## See Also

- [Guardian System](https://docs.openclaw.ai/tools/guardian)
- [API Key Protection](https://docs.openclaw.ai/tools/guardian#api-key-protection)
- [Configuration Guide](https://docs.openclaw.ai/configuration)
