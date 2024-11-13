# Discord Ticket Bot | بوت التذاكر في Discord

بوت لإدارة التذاكر في Discord يسمح للمستخدمين بفتح تذاكر للدعم الفني أو للاستفسارات العامة مع توفير صلاحيات مخصصة للأدوار، وتوجيه التذاكر إلى التصنيفات المناسبة، وإرسال نسخ من التذاكر عند إغلاقها.

A Discord ticket bot that allows users to open tickets for technical support or general inquiries, with custom role permissions, category-based ticket organization, and transcript generation upon ticket closure.

---

## المتطلبات | Requirements

- Node.js v16 أو أعلى / Node.js v16 or higher
- Discord.js
- SQLite3
- dotenv
- discord-html-transcripts

## الإعدادات | Setup

### 1. تنصيب المكتبات المطلوبة | Install Required Libraries

لتثبيت المكتبات اللازمة، استخدم الأمر التالي:  
To install the required libraries, use the following command:

```bash
npm install discord.js sqlite3 dotenv discord-html-transcripts
```

### 2. إعداد ملف `.env`

أنشئ ملف `.env` في جذر المشروع وأضف `TOKEN` الخاص بالبوت:  
Create a `.env` file in the project root and add your bot’s `TOKEN`:

```env
TOKEN=YOUR_DISCORD_BOT_TOKEN
```

### 3. إعداد ملف `config.json`

**config.json** هو ملف الإعدادات الرئيسي الذي يحتوي على معلومات عن أنواع التذاكر، ومعرفات القنوات، والأدوار.  
**config.json** is the main configuration file containing ticket types, channel IDs, and role IDs.

```json
{
  "allowedRoleId": "1305137116187070514",
  "clientId": "1300714209184841809",
  "guildId": "1273263917157716038",
  "transcriptChannelId": "1301822907424702474",
  "targetChannelId": "1302403245775261797",
  "ticketEmbed": {
    "title": "Create Ticket",
    "description": "Please Read Our <#1273263917157716040> Before Opening a Ticket",
    "color": "#a4c8fd"
  },
  "ticketTypes": [
    {
      "name": "Support",
      "description": "اختر هذا الخيار لطلب الدعم الفني.",
      "categoryId": "1301822808187207702",
      "emoji": "<:code:1296870102175846410>",
      "allowedCategoryRoleId": "1305137134121779211"
    },
    {
      "name": "استفسار عام",
      "description": "لطرح الأسئلة العامة.",
      "categoryId": "1303990330357579777",
      "emoji": "❓",
      "allowedCategoryRoleId": "1305137147212206181"
    }
  ]
}
```

### تفاصيل إعداد `config.json` | `config.json` Setup Details

- **allowedRoleId**: معرف الدور الذي يمكنه الوصول إلى جميع التذاكر.
- **allowedRoleId**: The ID of the role that can access all tickets.
- **clientId** و **guildId**: معرفات البوت والخادم.
- **clientId** and **guildId**: Bot and server (guild) IDs.
- **transcriptChannelId**: معرف القناة التي تُرسل إليها نسخ التذاكر بعد إغلاقها.
- **transcriptChannelId**: ID of the channel where transcripts are sent after closing tickets.
- **targetChannelId**: معرف القناة التي سترسل فيها رسالة التذاكر للاختيار.
- **targetChannelId**: ID of the channel where the ticket selection message is sent.
- **ticketEmbed**: إعدادات الرسالة الرئيسية التي توضح كيفية فتح التذاكر.
- **ticketEmbed**: Settings for the main ticket message that explains how to open tickets.
- **ticketTypes**: قائمة أنواع التذاكر، كل نوع يتضمن وصفًا، تصنيفًا، إيموجي مخصصًا، ومعرف الدور المسموح له برؤية هذا النوع من التذاكر.
- **ticketTypes**: List of ticket types, each with a description, category, emoji, and role ID allowed to view the ticket type.

---

## الميزات | Features

- **إنشاء تذكرة**: يمكن للمستخدمين اختيار نوع التذكرة وفتح قناة تذكرة خاصة بهم.
- **Ticket Creation**: Users can select ticket types and open private ticket channels.
- **إدارة الأذونات**: تخصيص صلاحيات الأدوار للوصول إلى أنواع التذاكر المختلفة.
- **Permission Management**: Allows roles to access specific ticket types based on configurations.
- **نسخ التذاكر**: عند إغلاق التذكرة، يتم إنشاء نسخة HTML للمحادثة وإرسالها إلى قناة مخصصة.
- **Ticket Transcripts**: Generates an HTML transcript upon ticket closure and sends it to a designated channel.
- **إضافة مشاركين**: يمكن لأعضاء آخرين المشاركة في تذكرة مفتوحة حسب الأذونات المحددة.
- **Add Participants**: Allows adding other members to an open ticket.
- **تنبيهات الأخطاء**: يتم إرسال تنبيه في القناة المحددة إذا كانت هناك مشكلة في الإعدادات.
- **Error Notifications**: Sends alerts to the specified channel if there are issues in configurations.

---

## تشغيل البوت | Running the Bot

1. تأكد من أن `TOKEN` موجود في `.env` وأن `config.json` يحتوي على الإعدادات الصحيحة.  
   Ensure `TOKEN` is in `.env` and that `config.json` has correct settings.
   
2. شغل البوت باستخدام الأمر التالي:  
   Run the bot using the following command:

   ```bash
   node index.js
   ```

---

## كيفية الاستخدام | How to Use

- بعد تشغيل البوت، سيرسل رسالة في القناة المخصصة تحتوي على قائمة بأنواع التذاكر المتاحة.
- After the bot is running, it sends a message in the specified channel listing the available ticket types.
- يمكن للمستخدمين فتح تذاكر جديدة حسب نوع الطلب الذي يختارونه من القائمة.
- Users can open new tickets based on the type selected from the list.
- يمكن لصاحب التذكرة أو الأدوار المحددة إغلاق التذكرة وحفظ نسخة منها في قناة النسخ.
- The ticket owner or designated roles can close tickets and save a transcript to the transcript channel.

---

## المساهمة | Contributing

مرحب بأي مساهمة لتحسين البوت أو إضافة ميزات جديدة. يمكنك فتح `Pull Request` على GitHub أو فتح `Issue` لاقتراح أفكار أو استفسارات.

Contributions to enhance the bot or add new features are welcome! You can open a Pull Request on GitHub or create an Issue to suggest ideas or ask questions.

---

## الدعم | Support

إذا كنت تواجه مشكلة في إعداد البوت أو لديك استفسار، لا تتردد في التواصل معي.

If you encounter an issue setting up the bot or have a question, feel free to reach out to me.

---

**ملاحظة**: تأكد من منح البوت الأذونات المناسبة في Discord، خاصةً أذونات **إدارة القنوات**، **إدارة الرسائل**، **قراءة سجل الرسائل**، و**إرسال الملفات**.

**Note**: Ensure the bot has the correct permissions in Discord, especially **Manage Channels**, **Manage Messages**, **Read Message History**, and **Attach Files** permissions.
```