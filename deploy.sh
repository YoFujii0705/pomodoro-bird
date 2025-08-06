#!/bin/bash

# Pomodoro Discord Bot Deployment Script
# Usage: ./deploy.sh [environment]

set -e

ENVIRONMENT=${1:-production}
BOT_DIR="/home/opc/pomodoro-discord-bot"
SERVICE_NAME="pomodoro-bot"

echo "🚀 Starting deployment for $ENVIRONMENT environment..."

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    echo "❌ Error: package.json not found. Make sure you're in the bot directory."
    exit 1
fi

# Load environment variables from .env file if it exists
if [[ -f ".env" ]]; then
    echo "📄 Loading environment variables from .env file..."
    export $(grep -v '^#' .env | xargs)
else
    echo "⚠️  No .env file found."
fi

# Check if Discord token is set
if [[ -z "$DISCORD_TOKEN" ]]; then
    echo "❌ Error: DISCORD_TOKEN environment variable is not set."
    echo "Please either:"
    echo "  1. Create a .env file with: echo 'DISCORD_TOKEN=your_token_here' > .env"
    echo "  2. Or set it manually with: export DISCORD_TOKEN=your_token_here"
    exit 1
fi

echo "✅ Discord token found and loaded."

echo "📦 Installing dependencies..."
npm install --production

echo "🔧 Creating logs directory..."
mkdir -p logs

echo "⚙️ Checking PM2 status..."
if pm2 list | grep -q $SERVICE_NAME; then
    echo "🔄 Restarting existing service..."
    pm2 restart $SERVICE_NAME
else
    echo "🆕 Starting new service..."
    pm2 start ecosystem.config.js
fi

echo "💾 Saving PM2 configuration..."
pm2 save

echo "📊 Showing PM2 status..."
pm2 status

echo "📝 Showing recent logs..."
pm2 logs $SERVICE_NAME --lines 10

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "📋 Useful commands:"
echo "  pm2 logs $SERVICE_NAME     - View logs"
echo "  pm2 restart $SERVICE_NAME  - Restart bot"
echo "  pm2 stop $SERVICE_NAME     - Stop bot"
echo "  pm2 status                 - Check status"
echo ""
echo "🤖 Your Pomodoro Discord Bot is now running!"
