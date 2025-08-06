#!/bin/bash

# Pomodoro Discord Bot Setup Script

echo "🍅 ポモドーロDiscord Bot セットアップ"
echo "=================================="

# Check if .env exists
if [[ -f ".env" ]]; then
    echo "✅ .env ファイルが見つかりました"
    
    # Check if DISCORD_TOKEN is set in .env
    if grep -q "DISCORD_TOKEN=" .env; then
        TOKEN_LINE=$(grep "DISCORD_TOKEN=" .env)
        if [[ "$TOKEN_LINE" == *"your_discord_bot_token_here"* ]] || [[ "$TOKEN_LINE" == "DISCORD_TOKEN=" ]]; then
            echo "⚠️  .envファイルにトークンが設定されていません"
            read -p "Discord Bot Token を入力してください: " DISCORD_TOKEN
            sed -i "s/DISCORD_TOKEN=.*/DISCORD_TOKEN=$DISCORD_TOKEN/" .env
            echo "✅ トークンを .env ファイルに保存しました"
        else
            echo "✅ Discord Bot Token が設定されています"
        fi
    else
        echo "⚠️  .envファイルにDISCORD_TOKENの行がありません"
        read -p "Discord Bot Token を入力してください: " DISCORD_TOKEN
        echo "DISCORD_TOKEN=$DISCORD_TOKEN" >> .env
        echo "✅ トークンを .env ファイルに追加しました"
    fi
else
    echo "📄 .env ファイルを作成します"
    read -p "Discord Bot Token を入力してください: " DISCORD_TOKEN
    echo "DISCORD_TOKEN=$DISCORD_TOKEN" > .env
    echo "NODE_ENV=production" >> .env
    echo "✅ .env ファイルを作成しました"
fi

echo ""
echo "📦 依存関係をインストールします..."
npm install

echo ""
echo "🔧 ログディレクトリを作成します..."
mkdir -p logs

echo ""
echo "✅ セットアップ完了！"
echo ""
echo "次のステップ:"
echo "1. ./deploy.sh を実行してボットを起動"
echo "2. または npm start で開発モードで起動"
echo ""
