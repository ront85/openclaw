# New Client Onboarding Runbook

How to add a new client to the Emorise OpenClaw Discord setup with full agent isolation.

## Architecture Overview

Each client gets:
- **3 Discord channels**: `#<client>-marketing`, `#<client>-sales`, `#<client>-general` (+ optional `#<client>-admin`)
- **3 OpenClaw agents**: `<client>-marketing`, `<client>-sales`, `<client>-general`
- **3 bindings**: routing each channel to its dedicated agent
- **Isolated workspaces**: separate SOUL.md (persona) and MEMORY.md (brand knowledge) per agent
- **Isolated sessions**: OpenClaw auto-creates unique session keys per channel

```
Discord Channel              →  OpenClaw Agent           →  Workspace
#acme-marketing              →  acme-marketing agent     →  SOUL.md + MEMORY.md (marketing)
#acme-sales                  →  acme-sales agent         →  SOUL.md + MEMORY.md (sales)
#acme-general                →  acme-general agent       →  SOUL.md + MEMORY.md (general)
```

## Infrastructure

- **Server**: `ssh hetzner-openclaw` (5.161.46.0)
- **Container**: `openclaw-openclaw-gateway-1`
- **Config file**: `/home/node/.openclaw/openclaw.json` (inside container)
- **Agent workspaces**: `/home/node/.openclaw/agents/<agent-id>/workspace/`
- **Auth profiles**: `/home/node/.openclaw/agents/<agent-id>/agent/auth-profiles.json`
- **Guild ID**: `1469457715280609406` (Emorise Discord server)
- **Bot Application ID**: `1469438990779416646`

## Step-by-Step: Add a New Client

Replace `<client>` with the client name in lowercase (e.g., `acmecorp`).

---

### Step 1: Discord — Create Category and Channels

In the Emorise Discord server:

1. **Create a role**: `@<Client>` (e.g., `@AcmeCorp`) with a distinctive colour
2. **Create a category**: `<Client>` (e.g., `AcmeCorp`)
3. **Set category permissions**:
   - `@everyone` → Deny View Channels
   - `@<Client>` → Allow View Channels, Send Messages
   - `@Emorise Staff` → Allow View Channels (already has Admin)
4. **Create text channels** inside the category:
   - `#<client>-marketing`
   - `#<client>-sales`
   - `#<client>-general`
   - `#<client>-admin` (optional, for client admins only)
5. **Copy Channel IDs** (Developer Mode → right-click channel → Copy Channel ID):
   - `<CLIENT>_MARKETING_CHANNEL_ID`
   - `<CLIENT>_SALES_CHANNEL_ID`
   - `<CLIENT>_GENERAL_CHANNEL_ID`
   - `<CLIENT>_ADMIN_CHANNEL_ID` (if created)

> The bot already has Administrator permissions, so it automatically has access to new channels.

---

### Step 2: OpenClaw Config — Add Agents

SSH into the server and edit the config:

```bash
ssh hetzner-openclaw
docker exec -it openclaw-openclaw-gateway-1 sh
vi /home/node/.openclaw/openclaw.json
```

Or download, edit locally, and re-upload:

```bash
ssh hetzner-openclaw 'docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/openclaw.json' > /tmp/openclaw-config.json
# edit /tmp/openclaw-config.json
scp /tmp/openclaw-config.json hetzner-openclaw:/tmp/openclaw-config.json
ssh hetzner-openclaw 'docker cp /tmp/openclaw-config.json openclaw-openclaw-gateway-1:/home/node/.openclaw/openclaw.json'
```

Add 3 agents to `agents.list`:

```json
{
  "id": "<client>-marketing",
  "model": { "primary": "openai-codex/gpt-5.3-codex" },
  "workspace": "/home/node/.openclaw/workspace-<client>-marketing"
},
{
  "id": "<client>-sales",
  "model": { "primary": "openai-codex/gpt-5.3-codex" },
  "workspace": "/home/node/.openclaw/workspace-<client>-sales"
},
{
  "id": "<client>-general",
  "model": { "primary": "openai-codex/gpt-5.3-codex" },
  "workspace": "/home/node/.openclaw/workspace-<client>-general"
}
```

---

### Step 3: OpenClaw Config — Add Channel Entries

Add to `channels.discord.guilds.*.channels`:

```json
"<client>-marketing": { "allow": true, "requireMention": false },
"<client>-sales": { "allow": true, "requireMention": false },
"<client>-general": { "allow": true, "requireMention": false },
"<client>-admin": { "allow": true, "requireMention": false }
```

---

### Step 4: OpenClaw Config — Add Bindings

Add to `bindings` array. Use the Discord Channel IDs from Step 1.

**Important**: The `peer.id` must be the raw numeric Discord Channel ID (no `channel:` prefix).

```json
{
  "agentId": "<client>-marketing",
  "match": {
    "channel": "discord",
    "guildId": "1469457715280609406",
    "peer": { "kind": "channel", "id": "<CLIENT_MARKETING_CHANNEL_ID>" }
  }
},
{
  "agentId": "<client>-sales",
  "match": {
    "channel": "discord",
    "guildId": "1469457715280609406",
    "peer": { "kind": "channel", "id": "<CLIENT_SALES_CHANNEL_ID>" }
  }
},
{
  "agentId": "<client>-general",
  "match": {
    "channel": "discord",
    "guildId": "1469457715280609406",
    "peer": { "kind": "channel", "id": "<CLIENT_GENERAL_CHANNEL_ID>" }
  }
},
{
  "agentId": "<client>-general",
  "match": {
    "channel": "discord",
    "guildId": "1469457715280609406",
    "peer": { "kind": "channel", "id": "<CLIENT_ADMIN_CHANNEL_ID>" }
  }
}
```

---

### Step 5: Create Agent Workspaces

Create workspace directories and the two key files for each agent:

```bash
ssh hetzner-openclaw

for func in marketing sales general; do
  docker exec openclaw-openclaw-gateway-1 mkdir -p /home/node/.openclaw/agents/<client>-${func}/workspace
done
```

---

### Step 6: Create SOUL.md Files (Agent Persona)

SOUL.md defines the agent's personality and behaviour. OpenClaw injects it into the system prompt.

**`<client>-marketing` SOUL.md:**

```markdown
# <Client> Marketing AI

You are the marketing assistant for **<Client>** (<client-website>), <one-line company description>.

## Your Role
Help the <Client> marketing team with campaigns, content creation, social media strategy, and brand messaging.

## Brand Voice
- <voice trait 1>
- <voice trait 2>
- <voice trait 3>

## Products/Services
- <product/service 1>
- <product/service 2>

## Guidelines
- Always align content with <Client> brand voice
- Respond in the same language the user writes in
```

**`<client>-sales` SOUL.md:**

```markdown
# <Client> Sales AI

You are the sales assistant for **<Client>** (<client-website>), <one-line company description>.

## Your Role
Help the <Client> sales team manage leads, answer product questions, and develop sales strategies.

## Sales Approach
- <approach 1>
- <approach 2>

## Products/Services
- <product/service 1>
- <product/service 2>

## Guidelines
- Be precise, data-driven, and customer-focused
- Respond in the same language the user writes in
```

**`<client>-general` SOUL.md:**

```markdown
# <Client> General AI

You are the general assistant for the **<Client>** team (<client-website>).

## Your Role
Help team members with general questions, documentation, scheduling, and internal tasks.

## Guidelines
- For marketing questions, suggest the #<client>-marketing channel
- For sales questions, suggest the #<client>-sales channel
- Respond in the same language the user writes in
```

Upload to container:

```bash
# From local machine
scp /tmp/soul-<client>-marketing.md hetzner-openclaw:/tmp/
scp /tmp/soul-<client>-sales.md hetzner-openclaw:/tmp/
scp /tmp/soul-<client>-general.md hetzner-openclaw:/tmp/

ssh hetzner-openclaw '
for func in marketing sales general; do
  docker cp /tmp/soul-<client>-${func}.md openclaw-openclaw-gateway-1:/home/node/.openclaw/agents/<client>-${func}/workspace/SOUL.md
done
'
```

---

### Step 7: Create MEMORY.md Files (Brand Knowledge)

MEMORY.md is indexed by the vector search system. It contains brand info, product details, and guidelines that the agent can retrieve during conversations.

Write a MEMORY.md for each agent with role-specific content:

- **Marketing**: brand guidelines, visual identity, tone examples, content pillars, channels
- **Sales**: product catalogue, pricing tiers, sales process, objection handling, differentiators
- **General**: company overview, key facts, common questions, team structure

Upload the same way as SOUL.md:

```bash
ssh hetzner-openclaw '
for func in marketing sales general; do
  docker cp /tmp/memory-<client>-${func}.md openclaw-openclaw-gateway-1:/home/node/.openclaw/agents/<client>-${func}/workspace/MEMORY.md
done
'
```

---

### Step 8: Copy Auth Profiles

Each agent needs authentication credentials. Copy from the main agent:

```bash
ssh hetzner-openclaw '
for func in marketing sales general; do
  docker exec openclaw-openclaw-gateway-1 sh -c "
    mkdir -p /home/node/.openclaw/agents/<client>-${func}/agent
    cp /home/node/.openclaw/agents/main/agent/auth-profiles.json /home/node/.openclaw/agents/<client>-${func}/agent/auth-profiles.json
  "
  echo "Auth profile copied to <client>-${func}"
done
'
```

---

### Step 9: Verify Config Reload

The config hot-reloads automatically. Check the logs:

```bash
ssh hetzner-openclaw 'docker logs --tail 10 openclaw-openclaw-gateway-1 2>&1'
```

You should see:

```
[reload] config change detected; evaluating reload (agents.list, bindings, ...)
[reload] config change applied (dynamic reads: ...)
```

If there are errors (e.g., `Unrecognized key`), fix and re-upload the config.

If the Discord bot is disconnected, restart the container:

```bash
ssh hetzner-openclaw 'docker restart openclaw-openclaw-gateway-1'
```

---

### Step 10: Test

1. Go to `#<client>-marketing` → send a message → verify the marketing agent responds with the correct persona
2. Go to `#<client>-sales` → send a message → verify the sales agent responds
3. Go to `#<client>-general` → send a message → verify the general agent responds
4. Verify isolation: a Theiss user should not see `<Client>` channels (Discord role permissions)

Check logs for routing:

```bash
ssh hetzner-openclaw 'docker logs --tail 30 openclaw-openclaw-gateway-1 2>&1'
```

Look for: `lane enqueue: lane=session:agent:<client>-marketing:discord:channel:...`

---

### Step 11: Invite Client Users

1. Have client team members join the Emorise Discord server
2. Assign the `@<Client>` role to each team member
3. They will only see channels in the `<Client>` category

Optional: add user IDs to the channel allowlist in config for an extra layer of isolation:

```json
"<client>-marketing": {
  "allow": true,
  "requireMention": false,
  "users": ["<discord_user_id_1>", "<discord_user_id_2>"]
}
```

---

## Isolation Layers Summary

| Layer | What It Does | Where |
|-------|-------------|-------|
| **Discord Roles** | Users only see their client's category/channels | Discord server settings |
| **Channel Allowlist** | Only listed user IDs can trigger the bot (optional) | `channels.discord.guilds.*.channels.<name>.users` |
| **Agent Bindings** | Each channel routes to a dedicated agent | `bindings` array in config |
| **Workspace Isolation** | Each agent has its own SOUL.md, MEMORY.md, sessions | `/home/node/.openclaw/agents/<id>/workspace/` |
| **Session Isolation** | Each channel gets a unique session key | Automatic (OpenClaw generates `agent:<id>:discord:channel:<channelId>`) |
| **Memory Isolation** | Each agent has its own vector search index | `/home/node/.openclaw/memory/<agentId>.sqlite` |

---

## Quick Reference: File Locations

```
/home/node/.openclaw/
├── openclaw.json                           # Main config (agents, bindings, channels)
├── agents/
│   ├── <client>-marketing/
│   │   ├── agent/
│   │   │   └── auth-profiles.json          # LLM authentication
│   │   └── workspace/
│   │       ├── SOUL.md                     # Agent persona
│   │       └── MEMORY.md                   # Brand knowledge (vector-indexed)
│   ├── <client>-sales/
│   │   ├── agent/
│   │   │   └── auth-profiles.json
│   │   └── workspace/
│   │       ├── SOUL.md
│   │       └── MEMORY.md
│   └── <client>-general/
│       ├── agent/
│       │   └── auth-profiles.json
│       └── workspace/
│           ├── SOUL.md
│           └── MEMORY.md
└── memory/
    ├── <client>-marketing.sqlite           # Vector search index (auto-created)
    ├── <client>-sales.sqlite
    └── <client>-general.sqlite
```

---

## Checklist

- [ ] Discord role created for client
- [ ] Discord category created with correct permissions (@everyone denied, @Client allowed)
- [ ] 3-4 channels created inside category
- [ ] Channel IDs copied
- [ ] 3 agents added to `agents.list` in config
- [ ] 3-4 channel entries added to `channels.discord.guilds.*.channels`
- [ ] 3-4 bindings added (channel ID → agent ID, no `channel:` prefix in peer.id)
- [ ] Agent workspace directories created
- [ ] SOUL.md created for each agent (persona)
- [ ] MEMORY.md created for each agent (brand knowledge)
- [ ] Auth profiles copied from main agent
- [ ] Config hot-reloaded (check logs for errors)
- [ ] Tested all 3 channels respond with correct agent persona
- [ ] Client users invited and assigned the role

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Bot doesn't respond | Discord WebSocket disconnected | `docker restart openclaw-openclaw-gateway-1` |
| Wrong agent responds | Binding peer.id has `channel:` prefix or wrong ID | Fix peer.id to raw numeric channel ID |
| All agents have same persona | SOUL.md missing or identical | Check workspace files for each agent |
| `Unrecognized key` in logs | Invalid config key (e.g., `systemPrompt`) | Remove the key; use SOUL.md for persona |
| `No API key found` | Agent missing auth-profiles.json | Copy from main agent |
| `no-mention` in logs | User didn't @mention bot and requireMention is true | Set `requireMention: false` on channel |
| 403 on channel API | Bot lacks permissions | Re-invite with Administrator (`permissions=8`) |
