const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// 音声機能は条件付きで読み込み
let voiceModule = null;
try {
    voiceModule = require('@discordjs/voice');
    console.log('音声モジュール読み込み成功');
} catch (error) {
    console.log('音声モジュールなし - テキスト通知のみ');
}

const path = require('path');
const fs = require('fs');

// 環境変数の読み込み
require('dotenv').config();

class OptimizedPomodoroBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates
            ]
        });

        // 状態管理（軽量化）
        this.userSessions = new Map();
        this.userStats = new Map();
        this.userPresets = new Map();
        
        // 音声関連（必要時のみ初期化）
        this.voiceConnections = new Map();
        this.audioPlayers = new Map();
        this.voiceEnabled = !!voiceModule;

        this.setupEvents();
        
        // メモリクリーンアップ（5分毎）
        setInterval(() => this.cleanupMemory(), 5 * 60 * 1000);
        
        // 音声接続ヘルスチェック（2分毎）
        if (this.voiceEnabled) {
            setInterval(() => this.voiceHealthCheck(), 2 * 60 * 1000);
        }
    }

    cleanupMemory() {
        // 完了したセッションのクリーンアップ
        for (const [userId, session] of this.userSessions.entries()) {
            if (!session.currentTimer) {
                this.userSessions.delete(userId);
            }
        }
        
        // 音声プレイヤーのクリーンアップ
        for (const [guildId, player] of this.audioPlayers.entries()) {
            if (player.state.status === voiceModule?.AudioPlayerStatus.Idle) {
                // アイドル状態のプレイヤーのリスナーをクリア
                player.removeAllListeners();
                // プレイヤーを削除はしない（再利用のため）
            }
        }
        
        // 使われていない音声接続のクリーンアップ
        for (const [guildId, connection] of this.voiceConnections.entries()) {
            if (connection.state.status === voiceModule?.VoiceConnectionStatus.Destroyed) {
                this.voiceConnections.delete(guildId);
                this.audioPlayers.delete(guildId);
            }
        }
        
        console.log('メモリクリーンアップ完了');
        
        // 強制ガベージコレクション（開発環境でのみ）
        if (global.gc && process.env.NODE_ENV === 'development') {
            global.gc();
        }
    }

    voiceHealthCheck() {
        if (!this.voiceEnabled) return;
        
        console.log(`音声ヘルスチェック開始 (${new Date().toLocaleTimeString()})`);
        
        for (const [guildId, connection] of this.voiceConnections.entries()) {
            const status = connection.state.status;
            console.log(`Guild ${guildId}: ${status}`);
            
            // 接続が不安定または切断されている場合
            if (status === voiceModule.VoiceConnectionStatus.Disconnected || 
                status === voiceModule.VoiceConnectionStatus.Destroyed) {
                console.log(`Guild ${guildId} の音声接続に問題があります。クリーンアップします。`);
                this.cleanupGuildVoice(guildId);
            }
        }
    }

    setupEvents() {
        this.client.once('ready', () => {
            console.log(`${this.client.user.tag} でログインしました！`);
            this.client.user.setActivity(`ポモドーロ ${this.voiceEnabled ? '🎵' : '📝'}`, { type: 'WATCHING' });
        });

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            try {
                await this.handleMessage(message);
            } catch (error) {
                console.error('メッセージ処理エラー:', error);
                await message.reply('❌ エラーが発生しました。しばらく待ってから再試行してください。').catch(() => {});
            }
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isButton()) {
                try {
                    await this.handleButtonInteraction(interaction);
                } catch (error) {
                    console.error('ボタン処理エラー:', error);
                    await interaction.reply({ content: '❌ エラーが発生しました。', ephemeral: true }).catch(() => {});
                }
            }
        });

        // エラーハンドリング
        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
        });

        // プロセス終了時のクリーンアップ
        process.on('SIGINT', () => {
            console.log('Botを終了しています...');
            this.cleanup();
            process.exit(0);
        });
    }

    cleanup() {
        // 全てのタイマーを停止
        for (const session of this.userSessions.values()) {
            if (session.currentTimer) {
                clearTimeout(session.currentTimer);
            }
        }
        
        // 音声プレイヤーのクリーンアップ
        if (this.voiceEnabled) {
            for (const player of this.audioPlayers.values()) {
                try {
                    player.removeAllListeners();
                    player.stop();
                } catch (error) {
                    console.error('プレイヤーのクリーンアップエラー:', error);
                }
            }
            this.audioPlayers.clear();
            
            // 音声接続を切断
            for (const connection of this.voiceConnections.values()) {
                try {
                    connection.removeAllListeners();
                    connection.destroy();
                } catch (error) {
                    console.error('音声接続切断エラー:', error);
                }
            }
            this.voiceConnections.clear();
        }
    }

    async handleMessage(message) {
        const args = message.content.trim().split(/\s+/);
        const command = args[0].toLowerCase();

        switch (command) {
            case '!join':
                if (this.voiceEnabled) {
                    await this.joinVoiceChannel(message);
                } else {
                    await message.reply('❌ 音声機能が利用できません。パッケージをインストールしてください。');
                }
                break;
            case '!leave':
                if (this.voiceEnabled) {
                    await this.leaveVoiceChannel(message);
                } else {
                    await message.reply('❌ 音声機能が利用できません。');
                }
                break;
            case '!vpomo':
            case '!voice-pomo':
                if (this.voiceEnabled) {
                    await this.startVoicePomodoro(message, args);
                } else {
                    await message.reply('❌ 音声機能が利用できません。`!pomo` で通常のポモドーロを使用してください。');
                }
                break;
            case '!pomodoro':
            case '!pomo':
                await this.startPomodoro(message, args);
                break;
            case '!stop':
                await this.stopSession(message);
                break;
            case '!status':
                await this.showStatus(message);
                break;
            case '!stats':
                await this.showStats(message);
                break;
            case '!preset':
                await this.handlePreset(message, args);
                break;
            case '!help':
                await this.showHelp(message);
                break;
        }
    }

    async joinVoiceChannel(message) {
        if (!this.voiceEnabled) {
            await message.reply('❌ 音声機能が利用できません。');
            return;
        }

        const voiceChannel = message.member?.voice?.channel;
        
        if (!voiceChannel) {
            await message.reply('❌ 先にボイスチャンネルに参加してください。');
            return;
        }

        try {
            // 既存の接続があれば完全にクリーンアップ
            const existingConnection = this.voiceConnections.get(message.guild.id);
            if (existingConnection) {
                await this.cleanupGuildVoice(message.guild.id);
            }

            const connection = voiceModule.joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            this.voiceConnections.set(message.guild.id, connection);

            // 接続状態の詳細監視
            connection.on(voiceModule.VoiceConnectionStatus.Ready, () => {
                console.log(`音声接続確立: ${voiceChannel.name} (${new Date().toLocaleTimeString()})`);
            });

            connection.on(voiceModule.VoiceConnectionStatus.Disconnected, async () => {
                console.log(`音声接続切断: ${new Date().toLocaleTimeString()}`);
                // 自動再接続を試行
                try {
                    await Promise.race([
                        voiceModule.entersState(connection, voiceModule.VoiceConnectionStatus.Signalling, 5000),
                        voiceModule.entersState(connection, voiceModule.VoiceConnectionStatus.Connecting, 5000),
                    ]);
                    console.log('音声接続を再確立しました');
                } catch (error) {
                    console.log('再接続に失敗、接続をクリーンアップします');
                    await this.cleanupGuildVoice(message.guild.id);
                }
            });

            connection.on('error', async (error) => {
                console.error('音声接続エラー:', error);
                await this.cleanupGuildVoice(message.guild.id);
            });

            // 接続の準備完了を待つ
            try {
                await voiceModule.entersState(connection, voiceModule.VoiceConnectionStatus.Ready, 10000);
                await message.reply(`✅ ボイスチャンネル "${voiceChannel.name}" に参加しました！\n🎵 音声通知付きポモドーロは \`!vpomo\` で開始できます。`);
            } catch (error) {
                console.error('接続確立タイムアウト:', error);
                await this.cleanupGuildVoice(message.guild.id);
                await message.reply('❌ 音声接続の確立がタイムアウトしました。再試行してください。');
            }

        } catch (error) {
            console.error('ボイスチャンネル参加エラー:', error);
            await message.reply('❌ ボイスチャンネルへの参加に失敗しました。');
        }
    }

    async cleanupGuildVoice(guildId) {
        // 音声プレイヤーのクリーンアップ
        const player = this.audioPlayers.get(guildId);
        if (player) {
            try {
                player.removeAllListeners();
                player.stop();
            } catch (error) {
                console.error('プレイヤー停止エラー:', error);
            }
            this.audioPlayers.delete(guildId);
        }

        // 音声接続のクリーンアップ
        const connection = this.voiceConnections.get(guildId);
        if (connection) {
            try {
                connection.removeAllListeners();
                connection.destroy();
            } catch (error) {
                console.error('接続切断エラー:', error);
            }
            this.voiceConnections.delete(guildId);
        }

        console.log(`Guild ${guildId} の音声リソースをクリーンアップしました`);
    }

    async leaveVoiceChannel(message) {
        const guildId = message.guild.id;
        
        if (!this.voiceConnections.has(guildId)) {
            await message.reply('❌ ボイスチャンネルに参加していません。');
            return;
        }

        // 完全なクリーンアップ
        await this.cleanupGuildVoice(guildId);
        
        // このサーバーの音声セッションを停止
        for (const [userId, session] of this.userSessions.entries()) {
            if (session.guildId === guildId && session.voiceEnabled) {
                clearTimeout(session.currentTimer);
                this.userSessions.delete(userId);
            }
        }

        await message.reply('✅ ボイスチャンネルから退出しました。');
    }

    async playSound(guildId, soundFile) {
        if (!this.voiceEnabled) return false;

        const connection = this.voiceConnections.get(guildId);
        if (!connection) {
            console.log('音声接続が見つかりません');
            return false;
        }

        // 接続状態を確認
        if (connection.state.status !== voiceModule.VoiceConnectionStatus.Ready) {
            console.log(`音声接続が準備完了していません: ${connection.state.status}`);
            // 接続の復旧を試行
            try {
                await voiceModule.entersState(connection, voiceModule.VoiceConnectionStatus.Ready, 3000);
            } catch (error) {
                console.log('音声接続の復旧に失敗しました');
                return false;
            }
        }

        const soundPath = path.join(__dirname, 'sounds', soundFile);
        
        if (!fs.existsSync(soundPath)) {
            console.log(`音声ファイルが見つかりません: ${soundPath}`);
            return false;
        }

        try {
            console.log(`音声再生開始: ${soundFile} (${new Date().toLocaleTimeString()})`);
            
            // 新しいプレイヤーを毎回作成（安定性向上）
            const player = voiceModule.createAudioPlayer({
                behaviors: {
                    noSubscriber: voiceModule.NoSubscriberBehavior.Pause,
                }
            });
            
            // MaxListeners警告を防ぐ
            player.setMaxListeners(3);

            // リソース作成
            const resource = voiceModule.createAudioResource(soundPath, {
                inlineVolume: true
            });
            
            // 音量設定
            resource.volume?.setVolume(0.4);

            // 接続にサブスクライブ
            const subscription = connection.subscribe(player);
            
            // 再生開始
            player.play(resource);

            // プレイヤーの管理（古いものを置き換える）
            const oldPlayer = this.audioPlayers.get(guildId);
            if (oldPlayer) {
                try {
                    oldPlayer.removeAllListeners();
                    oldPlayer.stop();
                } catch (error) {
                    console.error('古いプレイヤーの停止エラー:', error);
                }
            }
            this.audioPlayers.set(guildId, player);

            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.log('音声再生タイムアウト');
                    cleanup();
                    resolve(false);
                }, 8000); // 8秒でタイムアウト

                const cleanup = () => {
                    clearTimeout(timeout);
                    if (subscription) {
                        subscription.unsubscribe();
                    }
                    // プレイヤーのクリーンアップは次回の再生時に行う
                };

                player.once(voiceModule.AudioPlayerStatus.Idle, () => {
                    console.log(`音声再生完了: ${soundFile}`);
                    cleanup();
                    resolve(true);
                });
                
                player.once('error', (error) => {
                    console.error(`音声再生エラー (${soundFile}):`, error);
                    cleanup();
                    resolve(false);
                });
            });

        } catch (error) {
            console.error('音声再生処理エラー:', error);
            return false;
        }
    }

    async startVoicePomodoro(message, args) {
        const userId = message.author.id;
        const guildId = message.guild.id;
        
        if (!this.voiceConnections.has(guildId)) {
            await message.reply('❌ 先に `!join` でボイスチャンネルに参加させてください。');
            return;
        }

        if (this.userSessions.has(userId)) {
            await message.reply('❌ 既にポモドーロセッションが進行中です。`!stop`で停止してから新しいセッションを開始してください。');
            return;
        }

        const { workTime, breakTime, sets } = this.parseArgs(args, userId);
        if (!workTime) return; // parseArgsでエラーメッセージ送信済み

        // セッション開始（軽量化）
        const session = {
            userId,
            channelId: message.channel.id,
            guildId: guildId,
            workTime: workTime * 60 * 1000,
            breakTime: breakTime * 60 * 1000,
            totalSets: sets,
            currentSet: 1,
            isWorking: true,
            isPaused: false,
            startTime: Date.now(),
            currentTimer: null,
            message: message,
            voiceEnabled: true,
            remainingTime: workTime * 60 * 1000
        };

        this.userSessions.set(userId, session);

        // 非同期で音声再生（ブロックしない）
        this.playSound(guildId, 'start.mp3').catch(() => {
            console.log('音声再生に失敗しましたが、セッションは継続します');
        });
        
        const startEmbed = new EmbedBuilder()
            .setTitle('🎵🍅 音声ポモドーロ開始！')
            .setDescription(`<@${userId}> 集中して頑張りましょう！`)
            .addFields(
                { name: '設定', value: `${workTime}分作業 / ${breakTime}分休憩 / ${sets}セット`, inline: false }
            )
            .setColor('#9b59b6')
            .setTimestamp();

        await message.reply({ 
            content: `🎵 <@${userId}>`, 
            embeds: [startEmbed] 
        });

        await this.startTimer(session);
    }

    async startPomodoro(message, args) {
        const userId = message.author.id;
        
        if (this.userSessions.has(userId)) {
            await message.reply('❌ 既にポモドーロセッションが進行中です。`!stop`で停止してから新しいセッションを開始してください。');
            return;
        }

        const { workTime, breakTime, sets } = this.parseArgs(args, userId);
        if (!workTime) return; // parseArgsでエラーメッセージ送信済み

        const session = {
            userId,
            channelId: message.channel.id,
            guildId: message.guild.id,
            workTime: workTime * 60 * 1000,
            breakTime: breakTime * 60 * 1000,
            totalSets: sets,
            currentSet: 1,
            isWorking: true,
            isPaused: false,
            startTime: Date.now(),
            currentTimer: null,
            message: message,
            voiceEnabled: false,
            remainingTime: workTime * 60 * 1000
        };

        this.userSessions.set(userId, session);

        const startEmbed = new EmbedBuilder()
            .setTitle('🔔🍅 ポモドーロ開始！')
            .setDescription(`<@${userId}> 集中して頑張りましょう！`)
            .addFields(
                { name: '設定', value: `${workTime}分作業 / ${breakTime}分休憩 / ${sets}セット`, inline: false }
            )
            .setColor('#e74c3c')
            .setTimestamp();

        await message.reply({ 
            content: `🚀 <@${userId}>`, 
            embeds: [startEmbed] 
        });

        await this.startTimer(session);
    }

    parseArgs(args, userId) {
        let workTime = 25;
        let breakTime = 5;
        let sets = 4;

        if (args.length >= 4) {
            workTime = parseInt(args[1]);
            breakTime = parseInt(args[2]);
            sets = parseInt(args[3]);
        } else if (args.length === 2 && args[1]) {
            const presetName = args[1];
            const userPresets = this.userPresets.get(userId) || {};
            if (userPresets[presetName]) {
                const preset = userPresets[presetName];
                workTime = preset.workTime;
                breakTime = preset.breakTime;
                sets = preset.sets;
            } else {
                return { error: `❌ プリセット "${presetName}" が見つかりません。` };
            }
        }

        if (isNaN(workTime) || isNaN(breakTime) || isNaN(sets) || 
            workTime <= 0 || breakTime <= 0 || sets <= 0 ||
            workTime > 180 || breakTime > 60 || sets > 20) {
            return { error: '❌ 無効な値です。作業時間(1-180分)、休憩時間(1-60分)、セット数(1-20)を確認してください。' };
        }

        return { workTime, breakTime, sets };
    }

    async startTimer(session) {
        const isWork = session.isWorking;
        const duration = session.remainingTime || (isWork ? session.workTime : session.breakTime);
        const endTime = Date.now() + duration;

        session.currentEndTime = endTime;
        session.isPaused = false;
        session.remainingTime = duration;

        // 軽量な表示更新
        const embed = this.createSessionEmbed(session);
        const row = this.createControlButtons(session);
        
        try {
            if (session.lastMessageId) {
                const channel = this.client.channels.cache.get(session.channelId);
                const message = await channel.messages.fetch(session.lastMessageId);
                await message.edit({
                    embeds: [embed],
                    components: [row]
                });
            } else {
                const reply = await session.message.reply({
                    embeds: [embed],
                    components: [row]
                });
                session.lastMessageId = reply.id;
            }
        } catch (error) {
            console.error('メッセージ更新エラー:', error);
        }

        session.currentTimer = setTimeout(async () => {
            await this.onTimerComplete(session);
        }, duration);
    }

    async pauseSession(interaction, session) {
        if (session.isPaused) {
            await interaction.reply({ content: '❌ セッションは既に一時停止中です。', ephemeral: true });
            return;
        }

        clearTimeout(session.currentTimer);
        
        const now = Date.now();
        if (session.currentEndTime) {
            session.remainingTime = Math.max(0, session.currentEndTime - now);
        }
        
        session.isPaused = true;
        session.pauseTime = now;

        const embed = this.createSessionEmbed(session);
        const row = this.createControlButtons(session);
        
        await interaction.update({
            embeds: [embed],
            components: [row]
        });
    }

    async resumeSession(interaction, session) {
        if (!session.isPaused) {
            await interaction.reply({ content: '❌ セッションは停止していません。', ephemeral: true });
            return;
        }

        session.isPaused = false;
        const remainingTime = Math.max(1000, session.remainingTime || 1000);
        
        const newEndTime = Date.now() + remainingTime;
        session.currentEndTime = newEndTime;
        
        session.currentTimer = setTimeout(async () => {
            await this.onTimerComplete(session);
        }, remainingTime);

        const embed = this.createSessionEmbed(session);
        const row = this.createControlButtons(session);
        
        await interaction.update({
            embeds: [embed],
            components: [row]
        });
    }

    async stopSessionButton(interaction, session) {
        clearTimeout(session.currentTimer);
        this.userSessions.delete(session.userId);
        
        const embed = new EmbedBuilder()
            .setTitle('🛑 セッション停止')
            .setDescription('ポモドーロセッションが停止されました。')
            .setColor('#95a5a6')
            .setTimestamp();
            
        await interaction.update({
            embeds: [embed],
            components: []
        });
    }

    async handleButtonInteraction(interaction) {
        const userId = interaction.user.id;
        const session = this.userSessions.get(userId);

        if (!session) {
            await interaction.reply({ content: '❌ アクティブなセッションがありません。', ephemeral: true });
            return;
        }

        switch (interaction.customId) {
            case 'pause':
                await this.pauseSession(interaction, session);
                break;
            case 'resume':
                await this.resumeSession(interaction, session);
                break;
            case 'stop':
                await this.stopSessionButton(interaction, session);
                break;
        }
    }

    async onTimerComplete(session) {
        const channel = this.client.channels.cache.get(session.channelId);
        if (!channel) return;

        if (session.isWorking) {
            // 作業時間終了
            if (session.voiceEnabled) {
                // 非同期で音声再生（ブロックしない）
                this.playSound(session.guildId, 'work_end.mp3').catch(() => {});
            }

            const embed = new EmbedBuilder()
                .setTitle(session.voiceEnabled ? '🎵🍅 作業終了！' : '🔔🍅 作業終了！')
                .setDescription(`<@${session.userId}> お疲れさまでした！休憩時間です。`)
                .addFields({ name: '進捗', value: `${session.currentSet}/${session.totalSets} セット完了` })
                .setColor('#00ff00')
                .setTimestamp();

            await channel.send({ 
                content: `<@${session.userId}>`, 
                embeds: [embed] 
            });

            this.updateStats(session.userId, 'work');
            session.isWorking = false;
            session.remainingTime = session.breakTime;
            await this.startTimer(session);

        } else {
            // 休憩時間終了
            session.currentSet++;
            
            if (session.currentSet > session.totalSets) {
                // 全セット完了
                if (session.voiceEnabled) {
                    this.playSound(session.guildId, 'complete.mp3').catch(() => {});
                }

                const embed = new EmbedBuilder()
                    .setTitle('🎉 ポモドーロ完了！')
                    .setDescription(`<@${session.userId}> 素晴らしい！すべてのセットを完了しました。`)
                    .addFields({ name: '完了セット数', value: `${session.totalSets} セット` })
                    .setColor('#ffd700')
                    .setTimestamp();

                await channel.send({ 
                    content: `🏆 <@${session.userId}>`, 
                    embeds: [embed] 
                });
                this.userSessions.delete(session.userId);
                this.updateStats(session.userId, 'complete');
            } else {
                // 次の作業開始
                if (session.voiceEnabled) {
                    this.playSound(session.guildId, 'break_end.mp3').catch(() => {});
                }

                const embed = new EmbedBuilder()
                    .setTitle(session.voiceEnabled ? '🎵⏰ 休憩終了！' : '🔔⏰ 休憩終了！')
                    .setDescription(`<@${session.userId}> 次の作業セットを始めましょう！`)
                    .setColor('#ff6b6b')
                    .setTimestamp();

                await channel.send({ 
                    content: `<@${session.userId}>`, 
                    embeds: [embed] 
                });

                session.isWorking = true;
                session.remainingTime = session.workTime;
                await this.startTimer(session);
            }
        }
    }

    createSessionEmbed(session) {
        const isWork = session.isWorking;
        let status;
        let timeLeft;
        
        if (session.isPaused) {
            status = '⏸️ 一時停止中';
            timeLeft = Math.max(0, Math.floor((session.remainingTime || 0) / 1000));
        } else {
            status = session.voiceEnabled ? 
                (isWork ? '🎵🍅 作業中' : '🎵☕ 休憩中') :
                (isWork ? '🍅 作業中' : '☕ 休憩中');
            timeLeft = session.currentEndTime ? 
                Math.max(0, Math.floor((session.currentEndTime - Date.now()) / 1000)) : 0;
        }
        
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;

        return new EmbedBuilder()
            .setTitle(`${status}`)
            .setDescription(`セット ${session.currentSet}/${session.totalSets}`)
            .addFields(
                { name: '残り時間', value: `${minutes}:${seconds.toString().padStart(2, '0')}`, inline: true },
                { name: '次は', value: isWork ? '休憩' : (session.currentSet < session.totalSets ? '作業' : '完了'), inline: true }
            )
            .setColor(session.isPaused ? '#f39c12' : (session.voiceEnabled ? '#9b59b6' : (isWork ? '#e74c3c' : '#2ecc71')))
            .setTimestamp();
    }

    createControlButtons(session) {
        const pauseBtn = new ButtonBuilder()
            .setCustomId('pause')
            .setLabel('一時停止')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏸️')
            .setDisabled(session.isPaused);

        const resumeBtn = new ButtonBuilder()
            .setCustomId('resume')
            .setLabel('再開')
            .setStyle(ButtonStyle.Success)
            .setEmoji('▶️')
            .setDisabled(!session.isPaused);

        const stopBtn = new ButtonBuilder()
            .setCustomId('stop')
            .setLabel('停止')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🛑');

        return new ActionRowBuilder()
            .addComponents(pauseBtn, resumeBtn, stopBtn);
    }

    async stopSession(message) {
        const userId = message.author.id;
        const session = this.userSessions.get(userId);

        if (!session) {
            await message.reply('❌ アクティブなセッションがありません。');
            return;
        }

        clearTimeout(session.currentTimer);
        this.userSessions.delete(userId);
        await message.reply('🛑 ポモドーロセッションを停止しました。');
    }

    async showStatus(message) {
        const userId = message.author.id;
        const session = this.userSessions.get(userId);

        if (!session) {
            await message.reply('❌ アクティブなセッションがありません。');
            return;
        }

        const embed = this.createSessionEmbed(session);
        await message.reply({ embeds: [embed] });
    }

    async showStats(message) {
        const userId = message.author.id;
        const stats = this.userStats.get(userId) || { workSessions: 0, completedPomodoros: 0 };

        const embed = new EmbedBuilder()
            .setTitle('📊 ポモドーロ統計')
            .setColor('#9b59b6')
            .addFields(
                { name: '完了したポモドーロ', value: `${stats.completedPomodoros}`, inline: true },
                { name: '作業セッション', value: `${stats.workSessions}`, inline: true },
                { name: '推定作業時間', value: `${Math.floor(stats.workSessions * 25)} 分`, inline: true }
            )
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }

    async handlePreset(message, args) {
        // プリセット機能は軽量化のため簡略化
        await message.reply('プリセット機能は現在簡略化されています。直接パラメータを指定してください。\n例: `!pomo 25 5 4`');
    }

    async showHelp(message) {
        const embed = new EmbedBuilder()
            .setTitle(`🍅 軽量ポモドーロボット ${this.voiceEnabled ? '🎵' : '📝'}`)
            .setDescription('軽量化されたポモドーロテクニックサポート！')
            .setColor('#9b59b6')
            .addFields(
                {
                    name: '基本コマンド',
                    value: '`!pomo` - 通常ポモドーロ（25分/5分/4セット）\n' +
                           '`!pomo <作業> <休憩> <セット>` - カスタム設定\n' +
                           '`!stop` - セッション停止\n' +
                           '`!status` - 現在の状況\n' +
                           '`!stats` - 統計表示',
                    inline: false
                }
            );

        if (this.voiceEnabled) {
            embed.addFields({
                name: '🎵 音声機能',
                value: '`!join` - ボイスチャンネル参加\n' +
                       '`!vpomo` - 音声通知付きポモドーロ\n' +
                       '`!leave` - ボイスチャンネル退出',
                inline: false
            });
        }

        embed.addFields({
            name: '💡 軽量化のポイント',
            value: '• 音声は非同期処理で負荷軽減\n' +
                   '• メモリクリーンアップ機能付き\n' +
                   '• エラー時も継続動作\n' +
                   '• 一時停止・再開もサクサク動作',
            inline: false
        });

        await message.reply({ embeds: [embed] });
    }

    updateStats(userId, type) {
        if (!this.userStats.has(userId)) {
            this.userStats.set(userId, { workSessions: 0, completedPomodoros: 0 });
        }

        const stats = this.userStats.get(userId);
        
        if (type === 'work') {
            stats.workSessions++;
        } else if (type === 'complete') {
            stats.completedPomodoros++;
        }
    }

    async start(token) {
        try {
            await this.client.login(token);
        } catch (error) {
            console.error('ボットの起動に失敗しました:', error);
        }
    }
}

// 使用方法
const bot = new OptimizedPomodoroBot();
const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error('DISCORD_TOKEN環境変数が設定されていません');
    process.exit(1);
}

bot.start(token);
