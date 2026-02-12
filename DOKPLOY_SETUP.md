# Dokploy Setup Guide for OpenClaw

This guide walks you through setting up OpenClaw as a native Dokploy application with automatic deployment from GitHub.

## Prerequisites

- ✅ Dokploy installed and running on `5.161.46.0:3000`
- ✅ GitHub connected to Dokploy
- ✅ Repository: `ront85/openclaw` (branch: `main`)

## Step 1: Access Dokploy Dashboard

1. Open your browser and navigate to: `http://5.161.46.0:3000` (or your Dokploy domain)
2. Log in to Dokploy

## Step 2: Create a New Project

1. Click **"New Project"** in the Dokploy dashboard
2. **Project Name**: `openclaw`
3. **Description**: `OpenClaw Discord Bot Gateway`
4. Click **"Create Project"**

## Step 3: Create Application

1. Inside the `openclaw` project, click **"New Application"**
2. **Application Type**: Select **"Application"** (not Docker Compose)
3. **Application Name**: `openclaw-gateway`
4. **Description**: `OpenClaw Gateway with Discord Bot`

## Step 4: Configure Git Source

1. **Source Type**: `GitHub`
2. **Repository**: Select `ront85/openclaw` from the dropdown
3. **Branch**: `main`
4. **Build Path**: `/` (root directory)
5. **Auto Deploy**: ✅ **Enable** (this triggers deploy on every push)

## Step 5: Configure Build Settings

1. **Build Type**: `Dockerfile`
2. **Dockerfile Path**: `Dockerfile` (in root)
3. **Build Context**: `.` (current directory)
4. **Build Arguments**: Leave empty (we use environment variables instead)

## Step 6: Configure Environment Variables

Add the following environment variables:

| Variable Name               | Value                          | Description                    |
| --------------------------- | ------------------------------ | ------------------------------ |
| `HOME`                      | `/home/node`                   | Node home directory            |
| `TERM`                      | `xterm-256color`               | Terminal type                  |
| `OPENCLAW_GATEWAY_TOKEN`    | `<your-gateway-token>`         | Gateway authentication token   |
| `OPENCLAW_SECURE_INPUT_URL` | `https://gateway.emorise.com`  | Public URL for secure input    |
| `DISCORD_BOT_TOKEN`         | `<your-discord-token>`         | Discord bot token              |
| `OPENROUTER_API_KEY`        | `<your-openrouter-key>`        | OpenRouter API key             |
| `CLAUDE_AI_SESSION_KEY`     | `<optional>`                   | Claude AI session (if needed)  |
| `CLAUDE_WEB_SESSION_KEY`    | `<optional>`                   | Claude web session (if needed) |
| `CLAUDE_WEB_COOKIE`         | `<optional>`                   | Claude web cookie (if needed)  |
| `OPENCLAW_CONFIG_DIR`       | `/opt/openclaw-data`           | Persistent config directory    |
| `OPENCLAW_WORKSPACE_DIR`    | `/opt/openclaw-data/workspace` | Persistent workspace directory |

**Note**: Get actual values from `/opt/openclaw-data/.env` on the server.

## Step 7: Configure Volumes (Persistent Storage)

Add the following volume mounts:

| Host Path                      | Container Path                   | Description                    |
| ------------------------------ | -------------------------------- | ------------------------------ |
| `/opt/openclaw-data`           | `/home/node/.openclaw`           | Configuration and data storage |
| `/opt/openclaw-data/workspace` | `/home/node/.openclaw/workspace` | Workspace files                |

## Step 8: Configure Ports

Add the following port mappings:

| Host Port | Container Port | Protocol | Description       |
| --------- | -------------- | -------- | ----------------- |
| `18789`   | `18789`        | TCP      | Gateway WebSocket |
| `18790`   | `18790`        | TCP      | Bridge port       |

## Step 9: Configure Domains (Optional)

If you want to expose via Traefik:

1. **Domain**: `gateway.emorise.com`
2. **Path**: `/`
3. **Port**: `18789`
4. **HTTPS**: ✅ Enable (Let's Encrypt)

## Step 10: Configure Command/Entrypoint

1. **Command**:
   ```
   node dist/index.js gateway --bind lan --port 18789
   ```
2. **Entrypoint**: Leave default or set to `docker-entrypoint.sh`

## Step 11: Advanced Settings

1. **Restart Policy**: `unless-stopped`
2. **Init**: ✅ Enable (required for proper signal handling)
3. **Health Check**:
   - Command: `wget --spider -q http://localhost:18789/health || exit 1`
   - Interval: `30s`
   - Timeout: `10s`
   - Retries: `3`

## Step 12: Deploy

1. Click **"Save"** to save all configurations
2. Click **"Deploy"** to trigger the first deployment
3. Dokploy will:
   - Clone the repo
   - Build the Docker image (using Dockerfile)
   - Create and start the container
   - Monitor for future pushes

## Step 13: Verify Deployment

After deployment completes:

1. Check **Logs** tab in Dokploy to see:
   ```
   [gateway] listening on ws://0.0.0.0:18789
   [discord] logged in to discord
   ```
2. Test the bot in Discord with `/apikey`

## GitHub Webhook Configuration

Dokploy should automatically create a webhook in your GitHub repo. Verify:

1. Go to `https://github.com/ront85/openclaw/settings/hooks`
2. You should see a webhook pointing to your Dokploy instance
3. **Payload URL**: `https://your-dokploy-domain.com/api/github/webhook`
4. **Events**: Push events enabled

If the webhook doesn't exist, create it manually:

- URL: `http://5.161.46.0:3000/api/github/webhook`
- Content type: `application/json`
- Events: `Just the push event`

## Auto-Deployment Workflow

Once configured, the workflow is:

1. **You push to GitHub** (`git push origin main`)
2. **GitHub webhook triggers** Dokploy
3. **Dokploy automatically**:
   - Pulls latest code
   - Rebuilds Docker image
   - Deploys new container
   - Health checks
4. **Done!** New version is live

## Cleanup Old Manual Setup

Once Dokploy is working, you can remove the old manual docker-compose setup:

```bash
ssh hetzner-openclaw
cd /opt/openclaw
docker compose down
# Dokploy will now manage the containers
```

## Troubleshooting

### Build fails with "out of memory"

- The server has only 2GB RAM
- Dokploy builds remotely, so this shouldn't happen
- If it does, check Dokploy build settings and enable remote builder

### Webhook not triggering

- Check GitHub webhook delivery history
- Verify webhook URL is accessible
- Check Dokploy logs for webhook events

### Environment variables not loading

- Dokploy injects env vars at runtime
- Don't rely on `.env` files in the repo
- Use Dokploy's environment variable UI

### Volumes not persisting

- Ensure host paths exist: `/opt/openclaw-data`
- Check volume mount permissions
- Dokploy user needs access to host paths

## Next Steps

After setup:

1. Test auto-deployment by making a small change and pushing
2. Monitor Dokploy logs to see build and deploy process
3. Update `CLAUDE.md` with Dokploy-specific instructions
4. Remove manual SCP deployment scripts
