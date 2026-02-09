---
name: hetzner-deploy
description: "Deploy OpenClaw updates to Hetzner production server"
metadata:
  {
    "openclaw":
      {
        "emoji": "🚀",
        "skillKey": "hetzner-deploy",
        "homepage": "https://docs.openclaw.ai/deployment",
      },
  }
user-invocable: true
disable-model-invocation: false
---

# /hetzner-deploy - Deploy to Hetzner Production

Deploy the latest OpenClaw code to the Hetzner production server running in Docker.

## Overview

This skill automates the deployment process to the Hetzner server (`hetzner-openclaw`), handling:

1. **Git Pull**: Pull latest changes from main branch
2. **Merge Conflict Resolution**: Automatically resolve docker-compose.yml conflicts
3. **Container Restart**: Restart Docker containers with updated code
4. **Verification**: Check that services started successfully

## Prerequisites

- SSH key configured in `~/.ssh/config` with entry `hetzner-openclaw`
- Access to Hetzner server (5.161.46.0)
- Docker and Docker Compose installed on server

## Usage

```
/hetzner-deploy
```

The skill will:

1. Connect to Hetzner server via SSH
2. Navigate to `/opt/openclaw`
3. Stash any local changes (preserves production docker-compose.yml settings)
4. Pull latest code from GitHub
5. Resolve merge conflicts in docker-compose.yml (keeps Traefik config)
6. Restart Docker containers: `docker compose down && docker compose up -d`
7. Verify gateway and Discord bot started successfully

## Production Configuration

The Hetzner server has additional docker-compose.yml settings that are preserved during deployment:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.openclaw-gateway.rule=Host(`gateway.emorise.com`)"
  - "traefik.http.routers.openclaw-gateway.entrypoints=websecure"
  - "traefik.http.routers.openclaw-gateway.tls=true"
  - "traefik.http.routers.openclaw-gateway.tls.certresolver=letsencrypt"

networks:
  - dokploy-network

environment:
  - DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN}
  - OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}

command:
  - "--allow-unconfigured"
```

These settings enable:

- HTTPS access via Traefik reverse proxy
- Let's Encrypt SSL certificates
- Integration with Dokploy network
- Discord bot and OpenRouter API access

## Limitations

⚠️ **Memory Constraints**: The Hetzner server has only 2GB RAM, which is insufficient for `docker build`. The deployment restarts existing containers without rebuilding the Docker image.

To deploy a Docker image update:

1. Build locally: `docker build -t openclaw:local .`
2. Tag and push to registry, or
3. Wait for scheduled CI/CD build to update the image

## SSH Configuration

The skill expects this SSH config entry:

```
Host hetzner-openclaw
    HostName 5.161.46.0
    User root
    IdentityFile ~/.ssh/id_ed25519
```

## Troubleshooting

### Merge Conflicts

If git pull fails with merge conflicts:

```bash
# Manual resolution
ssh hetzner-openclaw
cd /opt/openclaw
git status
# Resolve conflicts, then:
git add .
git pull --rebase
```

### Container Won't Start

Check logs:

```bash
ssh hetzner-openclaw
cd /opt/openclaw
docker compose logs openclaw-gateway --tail 100
```

Common issues:

- Missing environment variables (check `.env` file)
- Port conflicts (18789, 18790)
- Network issues (dokploy-network must exist)

### Memory Issues

If you see "Killed" during operations:

```bash
# Check memory usage
ssh hetzner-openclaw
free -h
docker stats
```

Consider:

- Stopping other containers temporarily
- Upgrading server to 4GB RAM minimum

## Environment Variables

Required in `/opt/openclaw-data/.env` on the server:

```
OPENCLAW_IMAGE=openclaw:latest
OPENCLAW_CONFIG_DIR=/opt/openclaw-data/config
OPENCLAW_WORKSPACE_DIR=/opt/openclaw-data/workspace
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_BRIDGE_PORT=18790
OPENCLAW_GATEWAY_BIND=lan
OPENCLAW_GATEWAY_TOKEN=<secure-token>
DISCORD_BOT_TOKEN=<bot-token>
OPENROUTER_API_KEY=<api-key>
```

## Success Criteria

Deployment is successful when logs show:

```
[gateway] listening on ws://0.0.0.0:18789
[gateway] agent model: openrouter/x-ai/grok-4.1-fast
[discord] logged in to discord as <bot-id>
```

## Rollback

If deployment fails, rollback to previous version:

```bash
ssh hetzner-openclaw
cd /opt/openclaw
git log --oneline -5  # Find previous commit
git reset --hard <commit-hash>
docker compose restart
```

## Related Commands

- `ssh hetzner-openclaw` - Direct SSH access
- `docker compose logs -f openclaw-gateway` - Follow logs
- `docker compose ps` - Check container status
- `git status` - Check repository state on server

## See Also

- [Deployment Guide](https://docs.openclaw.ai/deployment)
- [Docker Configuration](https://docs.openclaw.ai/docker)
- [Hetzner Setup](https://docs.openclaw.ai/infrastructure/hetzner)
