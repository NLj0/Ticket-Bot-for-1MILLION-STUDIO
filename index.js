const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    InteractionType, 
    ChannelType 
} = require('discord.js');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { createTranscript } = require('discord-html-transcripts');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

// إنشاء عميل Discord مع النوايا اللازمة
const client = new Client({ 
    intents: [ 
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent 
    ]
});

// مسار ملف الإعدادات
const configPath = path.join(__dirname, 'config.json');

// التحقق من وجود ملف config.json
if (!fs.existsSync(configPath)) {
    console.error('❌ ملف config.json غير موجود في جذر المشروع.');
    process.exit(1);
}

// قراءة ملف config.json
let config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// الحصول على TOKEN من متغيرات البيئة
const { TOKEN } = process.env;
if (!TOKEN) {
    console.error('❌ متغير البيئة TOKEN مفقود.');
    process.exit(1);
}

// إعداد قاعدة بيانات SQLite
const db = new sqlite3.Database('./ticket.sqlite', (err) => {
    if (err) {
        console.error('❌ لم يتم فتح قاعدة البيانات:', err);
    } else {
        console.log('✅ Connected to SQLite database.');
    }
});

// تحويل دوال قاعدة البيانات إلى دوال تعد وعود (Promises)
const dbGet = promisify(db.get).bind(db);
const dbRun = promisify(db.run).bind(db);
const dbAll = promisify(db.all).bind(db);

// إنشاء جدول التذاكر إذا لم يكن موجودًا
(async () => {
    try {
        await dbRun(
            `CREATE TABLE IF NOT EXISTS tickets (
                channel_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                added_users TEXT,
                closed INTEGER DEFAULT 0
            );`
        );

        const result = await dbAll("PRAGMA table_info(tickets);");
        const columns = result.map(col => col.name);
        if (!columns.includes('closed')) {
            await dbRun('ALTER TABLE tickets ADD COLUMN closed INTEGER DEFAULT 0;');
            console.log('✅ Column "closed" added to tickets table.');
        }

        console.log('✅ Ticket table confirmed.');
    } catch (err) {
        console.error('❌ خطأ أثناء إنشاء جدول التذاكر:', err);
    }
})();

// دالة للتحقق من صلاحية التذاكر المخزنة في قاعدة البيانات
async function validateTickets() {
    try {
        const tickets = await dbAll('SELECT * FROM tickets');

        for (const ticket of tickets) {
            const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
            if (!channel || !channel.viewable) { // التحقق من قابلية عرض القناة للبوت
                await dbRun('DELETE FROM tickets WHERE channel_id = ?', ticket.channel_id);
                console.log(`🗑️ Invalid ticket removed from database: ${ticket.channel_id}`);
            }
        }
    } catch (error) {
        console.error('❌ خطأ أثناء التحقق من صلاحية التذاكر:', error);
    }
}

let ticketMessageId = null;

// دالة للتحقق من إعدادات التذاكر وصلاحيات الإيموجي
async function validateConfig() {
    const errors = [];

    for (const ticketType of config.ticketTypes) {
        const category = client.channels.cache.get(ticketType.categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) {
            errors.push(
                `⚠️ يوجد خطأ في categoryId لـ ${ticketType.name}، تحقق من أنه معرف تصنيف صحيح.`
            );
        }

        if (ticketType.emoji) {
            const customEmojiMatch = ticketType.emoji.match(/^<a?:\w+:(\d+)>$/);
            if (customEmojiMatch) {
                const emojiId = customEmojiMatch[1];
                const emoji = client.emojis.cache.get(emojiId);
                if (!emoji) {
                    errors.push(
                        `⚠️ لا يمكن الوصول إلى الإيموجي المخصص لـ ${ticketType.name}. تأكد من أن البوت لديه الصلاحية لاستخدامه.`
                    );
                }
            }
        }
    }

    let errorChannel;
    if (config.transcriptChannelId) {
        errorChannel = client.channels.cache.get(config.transcriptChannelId);
    }

    if (!errorChannel || !errorChannel.isTextBased()) {
        console.error(
            '❌ لم يتم العثور على قناة صالحة لإرسال الأخطاء في transcriptChannelId أو البوت ليس لديه إذن لإرسال الرسائل فيها.'
        );
        process.exit(1);
    }

    if (errors.length > 0) {
        const errorEmbed = new EmbedBuilder()
            .setTitle('⚠️ أخطاء في إعدادات التذاكر')
            .setDescription(errors.join('\n'))
            .setColor('#ff4d4d');

        await errorChannel.send({ embeds: [errorEmbed] });
    }
}

// دالة للتحقق من صلاحيات البوت في الخادم
async function checkPermissions(guild) {
    const missingPermissions = [];
    const requiredPermissions = [
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory
    ];

    const botMember = await guild.members.fetch(client.user.id);

    requiredPermissions.forEach((permission) => {
        if (!botMember.permissions.has(permission)) {
            missingPermissions.push(permission);
        }
    });

    if (missingPermissions.length > 0) {
        const owner = await guild.fetchOwner();

        const embed = new EmbedBuilder()
            .setTitle('⚠️ صلاحيات ناقصة')
            .setDescription('يحتاج البوت إلى الصلاحيات التالية ليعمل بشكل صحيح:')
            .addFields(
                missingPermissions.map((perm) => ({
                    name: perm.toString(),
                    value: '❌ مفقود'
                }))
            )
            .setColor('#ff4d4d');

        try {
            await owner.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ تعذر إرسال رسالة خاصة إلى مالك الخادم:', error);
        }

        const transcriptChannel = guild.channels.cache.get(config.transcriptChannelId);
        if (transcriptChannel && transcriptChannel.isTextBased()) {
            try {
                await transcriptChannel.send({ embeds: [embed] });
            } catch (error) {
                console.error('❌ تعذر إرسال رسالة في القناة المخصصة للنسخ:', error);
            }
        }
    }
}

client.once('ready', async () => {
    console.log(`✅ Bot connected and ready as ${client.user.username}`);

    // التأكد من تعيين clientId في config.json
    if (!config.clientId) {
        const clientId = client.user.id;
        config.clientId = clientId;
        console.log(`✅ تم تعيين clientId: ${clientId}`);
    }

    // الحصول على الخادم المستهدف
    const guild = client.guilds.cache.get(config.guildId) || client.guilds.cache.first();
    if (!guild) {
        console.error('❌ البوت ليس موجودًا في أي خادم.');
        process.exit(1);
    }

    // التأكد من تعيين guildId في config.json
    if (!config.guildId) {
        const guildId = guild.id;
        config.guildId = guildId;
        console.log(`✅ تم تعيين guildId: ${guildId}`);
    }

    // التحقق من وجود الدور المسموح به أو إنشاءه إذا لم يكن موجودًا
    if (config.allowedRoleId) {
        const adminRole = guild.roles.cache.get(config.allowedRoleId);
        if (!adminRole) {
            console.error(
                `❌ الدور بالمعرف ${config.allowedRoleId} غير موجود في الخادم ${guild.name}. سيتم إنشاء دور جديد باسم 'admin ticket'.`
            );
            try {
                const newAdminRole = await guild.roles.create({
                    name: 'admin ticket',
                    color: 'Blue',
                    permissions: [],
                    reason: 'تم إنشاء الدور من قبل البوت لإدارة التذاكر'
                });
                console.log(`✅ تم إنشاء الدور 'admin ticket' في الخادم ${guild.name}`);

                config.allowedRoleId = newAdminRole.id;

                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                console.log('✅ تم تحديث ملف config.json بالقيم الجديدة.');
            } catch (error) {
                console.error(`❌ فشل في إنشاء الدور في الخادم ${guild.name}:`, error);
            }
        } else {
            try {
                await adminRole.setPermissions([]);
            } catch (error) {
                console.error(
                    `❌ فشل في تحديث صلاحيات الدور '${adminRole.name}' في الخادم ${guild.name}:`,
                    error
                );
            }
        }
    } else {
        try {
            const adminRole = await guild.roles.create({
                name: 'admin ticket',
                color: 'Blue',
                permissions: [],
                reason: 'تم إنشاء الدور من قبل البوت لإدارة التذاكر'
            });
            console.log(`✅ تم إنشاء الدور 'admin ticket' في الخادم ${guild.name}`);

            config.allowedRoleId = adminRole.id;

            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            console.log('✅ تم تحديث ملف config.json بالقيم الجديدة.');
        } catch (error) {
            console.error(`❌ فشل في إنشاء الدور في الخادم ${guild.name}:`, error);
        }
    }

    // التحقق من صلاحيات البوت في الخادم
    await checkPermissions(guild);

    // التحقق من صحة الإعدادات والتذاكر
    await validateConfig();
    await validateTickets();

    // إرسال أو تحديث رسالة التذاكر
    await sendOrUpdateTicketMessage();
    setInterval(sendOrUpdateTicketMessage, 100000); // تحديث الرسالة كل 100 ثانية
});

// دالة لإرسال أو تحديث رسالة التذاكر في القناة المستهدفة
async function sendOrUpdateTicketMessage() {
    try {
        const channel = client.channels.cache.get(config.targetChannelId);
        if (!channel) {
            console.error('❌ لم يتم العثور على القناة المستهدفة.');
            return;
        }

        // التحقق من صلاحيات البوت في القناة المستهدفة
        if (!channel.permissionsFor(client.user).has([
            PermissionFlagsBits.ManageMessages, 
            PermissionFlagsBits.SendMessages
        ])) {
            console.error('❌ البوت ليس لديه إذن لإدارة الرسائل في القناة المستهدفة.');
            return;
        }

        // حذف الرسائل السابقة في القناة المستهدفة
        const fetchedMessages = await channel.messages.fetch({ limit: 100 });
        if (fetchedMessages.size > 0) {
            for (const message of fetchedMessages.values()) {
                await message.delete().catch((error) => {
                    console.error('❌ خطأ أثناء حذف الرسالة:', error);
                });
            }
        }

        // إنشاء الإيمبد الخاص برسالة التذاكر
        const embed = new EmbedBuilder()
            .setTitle(config.ticketEmbed.title)
            .setDescription(config.ticketEmbed.description)
            .setColor(config.ticketEmbed.color || '#a4c8fd');

        // إعداد خيارات قائمة الاختيار لأنواع التذاكر
        const options = config.ticketTypes.map((ticketType) => {
            let emoji = undefined;
            if (ticketType.emoji) {
                const customEmojiMatch = ticketType.emoji.match(/^<a?:\w+:(\d+)>$/);
                if (customEmojiMatch) {
                    const emojiId = customEmojiMatch[1];
                    const emojiObj = client.emojis.cache.get(emojiId);
                    if (emojiObj) {
                        emoji = {
                            id: emojiId,
                            name: emojiObj.name,
                            animated: emojiObj.animated
                        };
                    } else {
                        // إضافة إشعار إذا لم يتم العثور على الإيموجي
                        console.warn(`⚠️ لم يتم العثور على الإيموجي المخصص لـ ${ticketType.name}.`);
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

        // إنشاء قائمة الاختيار
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_ticket_type')
            .setPlaceholder('اختر نوع التذكرة')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        // إرسال الرسالة
        const message = await channel.send({ embeds: [embed], components: [row] });
        ticketMessageId = message.id;
    } catch (error) {
        console.error('❌ خطأ أثناء إرسال أو تحديث رسالة التذاكر:', error);
    }
}

// التعامل مع التفاعلات المختلفة من المستخدمين
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isStringSelectMenu()) {
            // التعامل مع قائمة الاختيار
            await handleSelectMenu(interaction);
        } else if (interaction.isButton()) {
            // التعامل مع الأزرار
            await handleButton(interaction);
        } else if (interaction.type === InteractionType.ModalSubmit) {
            // التعامل مع نماذج الإرسال (Modals)
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

// دالة للتعامل مع قائمة الاختيار
async function handleSelectMenu(interaction) {
    if (interaction.customId === 'select_ticket_type') {
        await interaction.deferReply({ ephemeral: true });

        const selectedValue = interaction.values[0];
        const ticketType = config.ticketTypes.find(
            (type) => type.name.toLowerCase().replace(/\s+/g, '_') === selectedValue
        );

        if (!ticketType) {
            return interaction.editReply({ content: '❌ نوع التذكرة غير معروف.' });
        }

        try {
            // التحقق مما إذا كان لدى المستخدم تذكرة مفتوحة بالفعل
            const existingTicket = await dbGet('SELECT * FROM tickets WHERE user_id = ? AND closed = 0', interaction.user.id);

            if (existingTicket) {
                const existingChannel = client.channels.cache.get(existingTicket.channel_id);

                if (existingChannel && existingChannel.viewable) {
                    return interaction.editReply({ content: '⚠️ لديك بالفعل تذكرة مفتوحة.' });
                } else {
                    await dbRun('UPDATE tickets SET closed = 1 WHERE channel_id = ?', existingTicket.channel_id);
                }
            }

            // إعداد الصلاحيات للقناة الجديدة
            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                },
                {
                    id: client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ManageChannels
                    ]
                }
            ];

            if (ticketType.allowedCategoryRoleId && ticketType.allowedCategoryRoleId !== '') {
                permissionOverwrites.push({
                    id: ticketType.allowedCategoryRoleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                });
            }

            if (config.allowedRoleId) {
                permissionOverwrites.push({
                    id: config.allowedRoleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                });
            }

            // التحقق من صلاحيات البوت قبل إنشاء القناة
            const guild = interaction.guild;
            const botMember = await guild.members.fetch(client.user.id);
            if (!botMember.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
                return interaction.editReply({ content: '❌ البوت لا يملك الصلاحيات اللازمة لإنشاء قنوات التذاكر.' });
            }

            // إنشاء القناة الجديدة للتذكرة
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: ticketType.categoryId,
                permissionOverwrites: permissionOverwrites
            });

            // حفظ التذكرة في قاعدة البيانات
            await dbRun('INSERT INTO tickets (channel_id, user_id, added_users, closed) VALUES (?, ?, ?, ?)',
                [ticketChannel.id, interaction.user.id, '', 0]
            );

            // إنشاء الإيمبد والأزرار داخل القناة الجديدة
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
                    .setStyle(ButtonStyle.Primary)
            );

            await ticketChannel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [embed],
                components: [rowButtons]
            });

            // إبلاغ المستخدم بفتح التذكرة
            await interaction.editReply({ content: `تم فتح تذكرتك: ${ticketChannel}` });
        } catch (error) {
            console.error('❌ خطأ أثناء فتح التذكرة:', error);

            if (error.code === 50035 && error.rawError?.errors?.parent_id) {
                return interaction.editReply({
                    content:
                        '❌ حدث خطأ أثناء إنشاء التذكرة. يبدو أن التصنيف المحدد غير صالح. يرجى التواصل مع مسؤول الخادم.',
                });
            } else {
                return interaction.editReply({ content: '❌ حدث خطأ أثناء إنشاء التذكرة.' });
            }
        }
    }
}

// دالة للتعامل مع الأزرار المختلفة
async function handleButton(interaction) {
    if (interaction.customId === 'close_ticket') {
        // التعامل مع زر إغلاق التذكرة
        try {
            await interaction.deferReply({ ephemeral: true });

            const channel = interaction.channel;

            // التحقق مما إذا كانت القناة تمثل تذكرة
            const row = await dbGet('SELECT * FROM tickets WHERE channel_id = ?', channel.id);
            if (!row) {
                return interaction.editReply({ content: '⚠️ هذه ليست تذكرة صالحة.' });
            }

            // التحقق من صلاحيات المستخدم لإغلاق التذكرة
            if (
                config.allowedRoleId &&
                !interaction.member.roles.cache.has(config.allowedRoleId) &&
                interaction.user.id !== row.user_id
            ) {
                return interaction.editReply({ content: '⚠️ ليس لديك إذن لإغلاق هذه التذكرة.' });
            }

            // تعطيل زر إغلاق التذكرة فقط في الرسالة الأولى للتذكرة
            const messages = await channel.messages.fetch({ limit: 10 });
        const ticketMessage = messages.find(
            (msg) => msg.components.length > 0 && msg.author.id === client.user.id
        );

        if (ticketMessage) {
            const updatedComponents = ticketMessage.components.map((actionRow) => {
                return new ActionRowBuilder().addComponents(
                    actionRow.components.map((component) => {
                        if (component.customId === 'close_ticket') {
                            // تعطيل زر "إغلاق التذكرة" فقط
                            return ButtonBuilder.from(component).setDisabled(true);
                        }
                        return component; // الأزرار الأخرى تظل كما هي
                    })
                );
            });
            await ticketMessage.edit({ components: updatedComponents });
        }

            const closingTime = new Date();
            const ticketOwner = await client.users.fetch(row.user_id).catch(() => null);
            const closedBy = interaction.user;
            const addedUsers = row.added_users ? row.added_users.split(',') : [];

            await channel.send(`🚪 سيتم إغلاق التذكرة في 5 ثوانٍ بواسطة ${interaction.user.tag}`);
            await new Promise((resolve) => setTimeout(resolve, 5000));

            // إزالة صلاحيات الوصول للمستخدمين
            const usersToRemove = [row.user_id, ...addedUsers];
            for (const userId of usersToRemove) {
                await channel.permissionOverwrites.edit(userId, {
                    ViewChannel: false,
                    SendMessages: false
                });
            }

            // حذف التذكرة من قاعدة البيانات
            await dbRun('UPDATE tickets SET closed = 1 WHERE channel_id = ?', channel.id);
            
            // تعديل اسم القناة وإضافة 🔒
            await channel.edit({ name: `${channel.name} 🔒` });

            // إنشاء النسخة (Transcript) من القناة
            const transcript = await createTranscript(channel, {
                filename: `${channel.name}.html`,
                limit: -1,
                returnBuffer: false
            });

            // إنشاء الإيمبد للإغلاق
            const embed = new EmbedBuilder()
                .setTitle('تم إغلاق التذكرة')
                .setDescription('تم إغلاق التذكرة. يمكنك تحميل النسخة من الزر أدناه.')
                .setColor('#ff4d4d')
                .addFields(
                    { name: 'صاحب التذكرة', value: `<@${row.user_id}>`, inline: true },
                    { name: 'أُغلقت بواسطة', value: `${closedBy.tag}`, inline: true },
                    {
                        name: 'وقت الإغلاق',
                        value: `<t:${Math.floor(closingTime.getTime() / 1000)}:F>`,
                        inline: true
                    }
                );

            if (addedUsers.length > 0) {
                const participants = addedUsers.map((id) => `<@${id}>`).join(', ');
                embed.addFields({ name: 'المرافقون', value: participants });
            }

            // إنشاء الأزرار للنسخة (حذف وحفظ)
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('delete_ticket')
                    .setLabel('حذف')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('save_ticket')
                    .setLabel('حفظ')
                    .setStyle(ButtonStyle.Success)
            );

            // إرسال الإيمبد والنسخة إلى القناة
            const sentMessage = await channel.send({
                embeds: [embed],
                files: [transcript],
                components: [actionRow]
            });

            const transcriptChannel = interaction.guild.channels.cache.get(config.transcriptChannelId);

            // إرسال النسخة إلى صاحب التذكرة عبر الرسائل الخاصة
            if (ticketOwner) {
                try {
                    const dmEmbed = EmbedBuilder.from(embed);
                    const dmMessage = await ticketOwner.send({ embeds: [dmEmbed], files: [transcript] });
                    const dmAttachmentUrl = dmMessage.attachments.first().url;
                    const dmRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('تحميل النسخة')
                            .setStyle(ButtonStyle.Link)
                            .setURL(dmAttachmentUrl)
                    );
                    await dmMessage.edit({ components: [dmRow] });
                } catch (error) {
                    console.error('❌ خطأ أثناء إرسال رسالة خاصة لصاحب التذكرة:', error);
                    // إشعار في قناة النسخ
                    if (transcriptChannel && transcriptChannel.isTextBased()) {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle('فشل إرسال رسالة خاصة')
                            .setDescription(`تعذر إرسال رسالة خاصة إلى صاحب التذكرة <@${ticketOwner.id}>`)
                            .setColor('#ff4d4d')
                            .addFields({ name: 'سبب الفشل', value: error.toString() });
                        await transcriptChannel.send({ embeds: [errorEmbed] });
                    }
                }
            }

            // إرسال النسخة إلى المرافقين عبر الرسائل الخاصة
            for (const userId of addedUsers) {
                const addedUser = await client.users.fetch(userId).catch(() => null);
                if (addedUser) {
                    try {
                        const dmEmbed = EmbedBuilder.from(embed);
                        const dmMessage = await addedUser.send({
                            embeds: [dmEmbed],
                            files: [transcript]
                        });
                        const dmAttachmentUrl = dmMessage.attachments.first().url;
                        const dmRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel('تحميل النسخة')
                                .setStyle(ButtonStyle.Link)
                                .setURL(dmAttachmentUrl)
                        );
                        await dmMessage.edit({ components: [dmRow] });
                    } catch (error) {
                        console.error(`❌ خطأ أثناء إرسال رسالة خاصة للمشارك ${userId}:`, error);
                        // إشعار في قناة النسخ
                        if (transcriptChannel && transcriptChannel.isTextBased()) {
                            const errorEmbed = new EmbedBuilder()
                                .setTitle('فشل إرسال رسالة خاصة')
                                .setDescription(`تعذر إرسال رسالة خاصة إلى المستخدم <@${userId}>`)
                                .setColor('#ff4d4d')
                                .addFields({ name: 'سبب الفشل', value: error.toString() });
                            await transcriptChannel.send({ embeds: [errorEmbed] });
                        }
                    }
                }
            }

            // إرسال النسخة إلى قناة النسخ
            if (transcriptChannel && transcriptChannel.isTextBased()) {
                try {
                    const transcriptMessage = await transcriptChannel.send({
                        embeds: [embed],
                        files: [transcript],
                    });
                    const transcriptAttachmentUrl = transcriptMessage.attachments.first().url;
                    const transcriptRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('تحميل النسخة')
                            .setStyle(ButtonStyle.Link)
                            .setURL(transcriptAttachmentUrl)
                    );
                    await transcriptMessage.edit({ components: [transcriptRow] });
                } catch (error) {
                    console.error('❌ خطأ أثناء إرسال النسخة إلى قناة النسخ:', error);
                }
            }

            await interaction.editReply({ content: '✅ تم إغلاق التذكرة بنجاح.' }).catch(console.error);
        } catch (error) {
            console.error('❌ خطأ أثناء إغلاق التذكرة:', error);
            if (!interaction.replied) {
                await interaction
                    .reply({ content: '❌ حدث خطأ أثناء إغلاق التذكرة.', ephemeral: true })
                    .catch(console.error);
            }
        }
    } else if (interaction.customId === 'delete_ticket') {
        // التعامل مع زر حذف التذكرة
        if (config.allowedRoleId && !interaction.member.roles.cache.has(config.allowedRoleId)) {
            return interaction.reply({ content: '⚠️ ليس لديك إذن لحذف هذه التذكرة.', ephemeral: true });
        }
        try {
            await interaction.channel.delete();
        } catch (error) {
            console.error('❌ خطأ أثناء حذف قناة التذكرة:', error);
            await interaction.reply({ content: '❌ حدث خطأ أثناء حذف التذكرة.', ephemeral: true }).catch(console.error);
        }
    } else if (interaction.customId === 'save_ticket') {
        // التعامل مع زر حفظ التذكرة
        if (config.allowedRoleId && !interaction.member.roles.cache.has(config.allowedRoleId)) {
            return interaction.reply({ content: '⚠️ ليس لديك إذن لحفظ هذه التذكرة.', ephemeral: true });
        }
        await interaction.reply({ content: '✅ تم حفظ التذكرة.', ephemeral: true });
            const channel = interaction.channel;
        try {
            await channel.edit({ name: `${channel.name} 📂` });
        } catch (error) {
            console.error('❌ خطأ أثناء تعديل اسم القناة:', error);
        }
        const message = interaction.message;
        if (message) {
            const updatedComponents = message.components.map((actionRow) => {
                return new ActionRowBuilder().addComponents(
                    actionRow.components.map((component) => ButtonBuilder.from(component).setDisabled(true))
                );
            });
            try {
                await message.edit({ components: updatedComponents }); // تعديل الرسالة
            } catch (error) {
                console.error('❌ خطأ أثناء تعديل الرسالة:', error);
            }
        }
    } else if (interaction.customId === 'add_user') {
        // التعامل مع زر إضافة مستخدم
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
            new ActionRowBuilder().addComponents(reasonInput)
        );

        await interaction.showModal(modal);
    } else if (interaction.customId === 'print_ticket') {
        // التعامل مع زر طباعة التذكرة
        await interaction.deferReply({ ephemeral: true });

        const channel = interaction.channel;
        try {
            const row = await dbGet('SELECT * FROM tickets WHERE channel_id = ?', channel.id);

            if (!row) {
                return interaction.editReply({ content: '⚠️ هذه ليست تذكرة صالحة.' });
            } else {
                const ticketOwnerId = row.user_id;
                const ticketOwner = await client.users.fetch(ticketOwnerId).catch(() => null);
                const requestedBy = interaction.user;
                const addedUsers = row.added_users ? row.added_users.split(',') : [];

                // إنشاء النسخة (Transcript) من القناة
                const transcript = await createTranscript(channel, {
                    limit: -1,
                    returnBuffer: false,
                    filename: `${channel.name}.html`
                });

                // إنشاء الإيمبد للإخطار بطباعة التذكرة
                const embed = new EmbedBuilder()
                    .setTitle('نسخة التذكرة')
                    .setDescription('إليك نسخة من التذكرة.')
                    .setColor('#a4c8fd')
                    .addFields(
                        { name: 'صاحب التذكرة', value: `<@${ticketOwnerId}>`, inline: true },
                        { name: 'طُلب بواسطة', value: `${requestedBy.tag}`, inline: true },
                        {
                            name: 'وقت الطلب',
                            value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                            inline: true
                        }
                    );

                if (addedUsers.length > 0) {
                    const participants = addedUsers.map((id) => `<@${id}>`).join(', ');
                    embed.addFields({ name: 'المشاركون', value: participants });
                }

                try {
                    // إرسال النسخة إلى المستخدم عبر الرسائل الخاصة
                    const dmEmbed = EmbedBuilder.from(embed);
                    const dmMessage = await interaction.user.send({
                        embeds: [dmEmbed],
                        files: [transcript]
                    });
                    const attachmentUrl = dmMessage.attachments.first().url;
                    const dmRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('تحميل النسخة')
                            .setStyle(ButtonStyle.Link)
                            .setURL(attachmentUrl)
                    );
                    await dmMessage.edit({ components: [dmRow] });

                    await interaction.editReply({
                        content: '✅ تم إرسال النسخة إلى رسائلك الخاصة.',
                        ephemeral: true
                    });
                } catch (error) {
                    console.error('❌ خطأ أثناء إرسال الرسالة الخاصة:', error);
                    // إشعار في قناة النسخ
                    const transcriptChannel = interaction.guild.channels.cache.get(config.transcriptChannelId);
                    if (transcriptChannel && transcriptChannel.isTextBased()) {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle('فشل إرسال رسالة خاصة')
                            .setDescription(
                                `تعذر إرسال نسخة التذكرة إلى المستخدم <@${interaction.user.id}>`
                            )
                            .setColor('#ff4d4d')
                            .addFields({ name: 'سبب الفشل', value: error.toString() });
                        await transcriptChannel.send({ embeds: [errorEmbed] });
                    }
                    await interaction.editReply({
                        content:
                            '❌ لا يمكن إرسال رسالة خاصة إليك. يرجى التحقق من إعدادات الخصوصية الخاصة بك.',
                        ephemeral: true
                    });
                }
            }
        } catch (error) {
            console.error('❌ خطأ أثناء طباعة التذكرة:', error);
            await interaction.editReply({ content: '❌ حدث خطأ أثناء إنشاء نسخة التذكرة.' });
        }
    }
}

// دالة للتعامل مع إرسال النموذج (Modal)
async function handleModalSubmit(interaction) {
    if (interaction.customId === 'add_user_modal') {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.fields.getTextInputValue('user_id').trim();
        const reason = interaction.fields.getTextInputValue('reason').trim();

        const channel = interaction.channel;

        try {
            const row = await dbGet('SELECT * FROM tickets WHERE channel_id = ?', channel.id);

            if (!row) {
                return interaction.editReply({ content: '⚠️ هذه ليست تذكرة صالحة.' });
            } else {
                const member = await interaction.guild.members.fetch(userId).catch(() => null);
                if (!member) {
                    return interaction.editReply({ content: '⚠️ لم يتم العثور على المستخدم.' });
                }

                // إضافة صلاحيات الوصول للمستخدم الجديد
                await channel.permissionOverwrites.edit(member, {
                    ViewChannel: true,
                    SendMessages: true
                });

                // تحديث قائمة المستخدمين المضافين في قاعدة البيانات
                let addedUsers = new Set(row.added_users ? row.added_users.split(',') : []);
                addedUsers.add(userId);
                await dbRun('UPDATE tickets SET added_users = ? WHERE channel_id = ?', [
                    Array.from(addedUsers).join(','),
                    channel.id,
                ]);

                // إبلاغ المستخدمين في القناة بعملية الإضافة
                await channel.send(`🔔 تم إضافة <@${userId}> إلى التذكرة.\nالسبب: ${reason}`);

                await interaction.editReply({ content: '✅ تم إضافة المستخدم بنجاح.' });
            }
        } catch (error) {
            console.error('❌ خطأ أثناء إضافة المستخدم:', error);
            await interaction.editReply({ content: '❌ حدث خطأ أثناء إضافة المستخدم.' });
        }
    }
}

// تسجيل الدخول باستخدام TOKEN
client.login(TOKEN);