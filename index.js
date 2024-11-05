const {Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, ChannelType} = require('discord.js');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { createTranscript } = require('discord-html-transcripts');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const client = new Client({ intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
    console.error('❌ ملف config.json غير موجود في جذر المشروع.');
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const { TOKEN } = process.env;
if (!TOKEN) {
    console.error('❌ متغير البيئة TOKEN مفقود.');
    process.exit(1);
}

const db = new sqlite3.Database('./ticket.sqlite', (err) => {
    if (err) {
        console.error('❌ لم يتم فتح قاعدة البيانات:', err);
    } else {
        console.log('✅ Connected to SQLite database.');
    }
});

const dbGet = promisify(db.get).bind(db);
const dbRun = promisify(db.run).bind(db);

dbRun(`CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    added_users TEXT
);`).then(() => {
    console.log('✅ Ticket table confirmed.');
}).catch(err => {
    console.error('❌ خطأ أثناء إنشاء جدول التذاكر:', err);
});

let ticketMessageId = null;

async function validateConfig() {
    const errors = [];

    for (const ticketType of config.ticketTypes) {
        const category = await client.channels.fetch(ticketType.categoryId).catch(() => null);
        if (!category || category.type !== ChannelType.GuildCategory) {
            errors.push(`⚠️ يوجد خطأ في categoryId لـ ${ticketType.name}، تحقق من أنه معرف تصنيف صحيح.`);
        }

        if (ticketType.emoji) {
            const customEmojiMatch = ticketType.emoji.match(/^<a?:\w+:(\d+)>$/);
            if (customEmojiMatch) {
                const emojiId = customEmojiMatch[1];
                const emoji = client.emojis.cache.get(emojiId);
                if (!emoji) {
                    errors.push(`⚠️ لا يمكن الوصول إلى الإيموجي المخصص لـ ${ticketType.name}. تأكد من أن البوت لديه الصلاحية لاستخدامه.`);
                }
            }
        }
    }

    let errorChannel;
    if (config.transcriptChannelId) {
        errorChannel = await client.channels.fetch(config.transcriptChannelId).catch(() => null);
    }

    if (!errorChannel || !errorChannel.isTextBased()) {
        console.error('❌ لم يتم العثور على قناة صالحة لإرسال الأخطاء في transcriptChannelId أو البوت ليس لديه إذن لإرسال الرسائل فيها.');
        process.exit(1);
    }

    if (errors.length > 0) {
        const errorEmbed = new EmbedBuilder()
            .setTitle('⚠️ أخطاء في إعدادات التذاكر')
            .setDescription(errors.join('\n'))
            .setColor('#ff4d4d');

        await errorChannel.send({ embeds: [errorEmbed] });
    } else {
        console.log('✅ تم التحقق من إعدادات التذاكر وجميع التصنيفات والإيموجيات صالحة.');
    }
}

// حدث عند تشغيل البوت
client.once('ready', async () => {
    console.log(`✅ Bot connected and ready as ${client.user.username}`);
    await validateConfig();
    await sendOrUpdateTicketMessage();
    setInterval(sendOrUpdateTicketMessage, 60000);
});

async function sendOrUpdateTicketMessage() {
    try {
        const channel = await client.channels.fetch(config.targetChannelId);
        if (!channel) {
            console.error('❌ لم يتم العثور على القناة المستهدفة.');
            return;
        }

        try {
            const fetchedMessages = await channel.messages.fetch({ limit: 100 });
            if (fetchedMessages.size > 0) {
                for (const message of fetchedMessages.values()) {
                    await message.delete().catch(() => null);
                }
            }
        } catch (error) {
            console.error('❌ حدث خطأ أثناء محاولة حذف الرسائل القديمة:', error);
            return; 
        }

        const embed = new EmbedBuilder()
            .setTitle(config.ticketEmbed.title)
            .setDescription(config.ticketEmbed.description)
            .setColor(config.ticketEmbed.color || '#a4c8fd');

        const options = config.ticketTypes.map(ticketType => {
            let emoji = undefined;
            if (ticketType.emoji) {
                const customEmojiMatch = ticketType.emoji.match(/^<a?:\w+:(\d+)>$/);
                if (customEmojiMatch) {
                    const emojiId = customEmojiMatch[1];
                    const emojiObj = client.emojis.cache.get(emojiId);
                    if (emojiObj) {
                        emoji = { id: emojiId, name: emojiObj.name, animated: emojiObj.animated };
                    }
                } else {
                    emoji = ticketType.emoji;
                }
            }
            return {
                label: ticketType.name,
                description: ticketType.description,
                value: ticketType.name.toLowerCase().replace(/\s+/g, '_'),
                emoji: emoji
            };
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_ticket_type')
            .setPlaceholder('اختر نوع التذكرة')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const message = await channel.send({ embeds: [embed], components: [row] });
        ticketMessageId = message.id;
    } catch (error) {
        console.error('❌ خطأ أثناء إرسال أو تحديث رسالة التذاكر:', error);
    }
}

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction);
        } else if (interaction.isButton()) {
            await handleButton(interaction);
        } else if (interaction.type === InteractionType.ModalSubmit) {
            await handleModalSubmit(interaction);
        }
    } catch (error) {
        console.error('❌ خطأ أثناء معالجة التفاعل:', error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: '❌ حدث خطأ غير متوقع.', ephemeral: true });
        } else {
            await interaction.reply({ content: '❌ حدث خطأ غير متوقع.', ephemeral: true });
        }
    }
});

// معالج القائمة المنسدلة
async function handleSelectMenu(interaction) {
    if (interaction.customId === 'select_ticket_type') {
        const selectedValue = interaction.values[0];
        const ticketType = config.ticketTypes.find(type => type.name.toLowerCase().replace(/\s+/g, '_') === selectedValue);

        if (!ticketType) {
            return interaction.reply({ content: '❌ نوع التذكرة غير معروف.', ephemeral: true });
        }

        try {
            const existingTicket = await dbGet('SELECT * FROM tickets WHERE user_id = ?', [interaction.user.id]);

            if (existingTicket) {
                return interaction.reply({ content: '⚠️ لديك بالفعل تذكرة مفتوحة.', ephemeral: true });
            } else {
                const ticketChannel = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: ticketType.categoryId,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: interaction.user.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                        },
                        {
                            id: client.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ManageChannels
                            ],
                        },
                    ],
                });

                await dbRun('INSERT INTO tickets (channel_id, user_id, added_users) VALUES (?, ?, ?)', [ticketChannel.id, interaction.user.id, '']);

                const embed = new EmbedBuilder()
                    .setTitle(`تذكرة دعم - ${interaction.user.username}`)
                    .setDescription('اختر أحد الأزرار أدناه لإدارة التذكرة.')
                    .setColor('#a4c8fd');

                const rowButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('إغلاق التذكرة')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('add_user')
                        .setLabel('إضافة شخص')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('print_ticket')
                        .setLabel('طباعة التذكرة')
                        .setStyle(ButtonStyle.Primary),
                );

                await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [rowButtons] });

                await interaction.reply({ content: `✅ تم فتح تذكرتك: ${ticketChannel}`, ephemeral: true });
            }
        } catch (error) {
            console.error('❌ خطأ أثناء فتح التذكرة:', error);
            return interaction.reply({ content: '❌ حدث خطأ أثناء إنشاء التذكرة.', ephemeral: true });
        }
    }
}

async function handleButton(interaction) {
    if (interaction.customId === 'close_ticket') {
        const channel = interaction.channel;
        try {
            const row = await dbGet('SELECT * FROM tickets WHERE channel_id = ?', [channel.id]);

            if (!row) {
                return interaction.reply({ content: '⚠️ هذه ليست تذكرة صالحة.', ephemeral: true });
            } else {
                if (config.allowedUserId) {
                    if (interaction.user.id !== config.allowedUserId) {
                        return interaction.reply({ content: '⚠️ ليس لديك إذن لإغلاق هذه التذكرة.', ephemeral: true });
                    }
                }

                await interaction.deferReply({ ephemeral: true });

                const transcript = await createTranscript(channel, { limit: -1, returnBuffer: false, fileName: `transcript-${channel.id}.html` });

                const user = await client.users.fetch(row.user_id).catch(() => null);
                if (user) {
                    try {
                        await user.send({
                            content: '📝 إليك نسخة من تذكرتك:',
                            files: [transcript],
                        });
                    } catch (error) {
                        console.error(`❌ لم يتمكن من إرسال النسخة إلى ${user.tag}.`);
                        await channel.send({
                            content: `⚠️ لم أتمكن من إرسال نسخة التذكرة إلى <@${user.id}>. ربما قام بتعطيل الرسائل الخاصة.`,
                        });
                    }
                }

                if (row.added_users) {
                    const addedUsers = row.added_users.split(',');
                    for (const userId of addedUsers) {
                        const addedUser = await client.users.fetch(userId).catch(() => null);
                        if (addedUser) {
                            try {
                                await addedUser.send({
                                    content: '📝 إليك نسخة من التذكرة التي شاركت فيها:',
                                    files: [transcript],
                                });
                            } catch (error) {
                                console.error(`❌ لم يتمكن من إرسال النسخة إلى ${addedUser.tag}.`);
                            }
                        }
                    }
                }

                const transcriptChannel = interaction.guild.channels.cache.get(config.transcriptChannelId);
                if (transcriptChannel) {
                    try {
                        await transcriptChannel.send({
                            content: `📝 نسخة من التذكرة المغلقة <#${channel.id}> بواسطة ${interaction.user.tag}:`,
                            files: [transcript]
                        });
                    } catch (error) {
                        console.error('❌ خطأ أثناء إرسال النسخة إلى قناة النسخ:', error);
                    }
                } else {
                    console.error('❌ لم يتم العثور على transcriptChannelId في الإعدادات.');
                }

                await interaction.followUp({ content: '✅ يتم إغلاق التذكرة بعد 5 ثوانٍ بنجاح.', ephemeral: true });

                await channel.send('🚪 التذكرة ستغلق في 5 ثوانٍ...');

                await new Promise(resolve => setTimeout(resolve, 5000));

                await channel.delete().catch(console.error);

                await dbRun('DELETE FROM tickets WHERE channel_id = ?', [channel.id]);
            }
        } catch (error) {
            console.error('❌ خطأ أثناء إغلاق التذكرة:', error);
            await interaction.editReply({ content: '❌ حدث خطأ أثناء إغلاق التذكرة.', ephemeral: true });
        }
    } else if (interaction.customId === 'add_user') {
        const modal = new ModalBuilder()
            .setCustomId('add_user_modal')
            .setTitle('إضافة شخص إلى التذكرة');

        const userInput = new TextInputBuilder()
            .setCustomId('user_id')
            .setLabel('معرف المستخدم')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('أدخل معرف المستخدم')
            .setRequired(true);

        const reasonInput = new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('سبب الإضافة')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('أدخل سبب الإضافة')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(userInput),
            new ActionRowBuilder().addComponents(reasonInput),
        );

        await interaction.showModal(modal);
    } else if (interaction.customId === 'print_ticket') {
        const channel = interaction.channel;
        try {
            const row = await dbGet('SELECT * FROM tickets WHERE channel_id = ?', [channel.id]);

            if (!row) {
                return interaction.reply({ content: '⚠️ هذه ليست تذكرة صالحة.', ephemeral: true });
            } else {
                const transcript = await createTranscript(channel, { limit: -1, returnBuffer: false, fileName: `transcript-${channel.id}.html` });
                await interaction.reply({ content: '📝 إليك نسخة من التذكرة:', files: [transcript], ephemeral: true });
            }
        } catch (error) {
            console.error('❌ خطأ أثناء طباعة التذكرة:', error);
            await interaction.reply({ content: '❌ حدث خطأ أثناء إنشاء نسخة التذكرة.', ephemeral: true });
        }
    }
}

async function handleModalSubmit(interaction) {
    if (interaction.customId === 'add_user_modal') {
        const userId = interaction.fields.getTextInputValue('user_id').trim();
        const reason = interaction.fields.getTextInputValue('reason').trim();

        const channel = interaction.channel;

        try {
            const row = await dbGet('SELECT * FROM tickets WHERE channel_id = ?', [channel.id]);

            if (!row) {
                return interaction.reply({ content: '⚠️ هذه ليست تذكرة صالحة.', ephemeral: true });
            } else {
                const member = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!member) {
                    return interaction.reply({ content: '⚠️ لم يتم العثور على المستخدم.', ephemeral: true });
                }

                await channel.permissionOverwrites.edit(member, {
                    ViewChannel: true,
                    SendMessages: true,
                });

                let addedUsers = row.added_users ? row.added_users.split(',') : [];
                if (!addedUsers.includes(userId)) {
                    addedUsers.push(userId);
                    await dbRun('UPDATE tickets SET added_users = ? WHERE channel_id = ?', [addedUsers.join(','), channel.id]);
                }

                await channel.send(`🔔 تم إضافة <@${userId}> إلى التذكرة.\nالسبب: ${reason}`);

                await interaction.reply({ content: '✅ تم إضافة المستخدم بنجاح.', ephemeral: true });
            }
        } catch (error) {
            console.error('❌ خطأ أثناء إضافة المستخدم:', error);
            await interaction.reply({ content: '❌ حدث خطأ أثناء إضافة المستخدم.', ephemeral: true });
        }
    }
}

client.login(TOKEN);