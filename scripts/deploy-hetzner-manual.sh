#!/usr/bin/env bash
set -e

echo "🚀 Manual Hetzner Deployment Script"
echo "===================================="
echo ""

# Build Docker image locally
echo "📦 Building Docker image locally..."
docker buildx build --platform linux/amd64 --tag openclaw:latest --load .

# Save and compress
echo "💾 Saving Docker image..."
docker save openclaw:latest | gzip > /tmp/openclaw-latest.tar.gz

# Transfer to server
echo "📤 Transferring to Hetzner server..."
scp /tmp/openclaw-latest.tar.gz hetzner-openclaw:/tmp/

# Deploy on server
echo "🚢 Deploying on server..."
ssh hetzner-openclaw << 'ENDSSH'
  # Load new image
  docker load < /tmp/openclaw-latest.tar.gz

  # Pull latest code
  cd /opt/openclaw
  git pull origin main

  # Restart services
  docker compose down
  docker compose up -d

  # Cleanup
  rm /tmp/openclaw-latest.tar.gz

  # Show logs
  echo ""
  echo "📋 Gateway logs:"
  docker compose logs openclaw-gateway --tail 30
ENDSSH

# Cleanup local
rm /tmp/openclaw-latest.tar.gz

echo ""
echo "✅ Deployment complete!"
echo "🌐 Test at: https://gateway.emorise.com/secure-input"
