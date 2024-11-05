Here's an English version of the instructions for setting up the Studio Million Discord Ticket Bot:

---

## Introduction

Welcome to the **Studio Million Discord Ticket Bot**! This bot is designed to streamline ticket management and support within your Discord server efficiently. Whether you're managing a gaming community, a technical support server, or any other type of Discord server that requires organized ticket handling, this bot meets your needs with ease and effectiveness.

## Installation

To set up the Studio Million Discord Ticket Bot, follow these steps:

- **Node.js**: Version 16.6.0 or higher. [Download Node.js](https://nodejs.org/)
- **Discord Bot Token**: You can create a bot and obtain its token from the [Discord Developer Portal](https://discord.com/developers/applications).
- **Discord Bot Invite Link**: Replace `[YOUR_BOT_CLIENT_ID]` with your bot's client ID in the following URL:
  ```
  https://discord.com/oauth2/authorize?client_id=[YOUR_BOT_CLIENT_ID]&scope=bot&permissions=268446720
  ```

## Requirements

1. **.env File**:
   Create a file named `.env` at the root of your project and add the following environment variables:
   ```plaintext
   TOKEN=YOUR_DISCORD_BOT_TOKEN
   ```

2. **config.json**:
   Define the configuration for the ticket bot in `config.json` as follows:

   ```json
   {
     "ticketEmbed": {
       "title": "Title of the Embed Message",
       "description": "Description shown in the Embed",
       "color": "#HEXCOLOR"
     },
     "ticketTypes": [
       {
         "name": "Feature Request",
         "categoryId": "123456789",
         "description": "Select this option to request a new feature.",
         "emoji": "✨"
       }
     ],
     "targetChannelId": "123456789",
     "allowedUserId": "",
     "clientId": "123456789",
     "guildId": "123456789",
     "transcriptChannelId": "123456789"
   }
   ```

   - **ticketEmbed**:
     - `title`: Title of the embed message.
     - `description`: A description that appears in the embed.
     - `color`: The color of the embed (in hex format).

   - **ticketTypes**: Array defining the different ticket types.
     - `name`: The name of the ticket type that will appear in the list.
     - `categoryId`: Category ID where this ticket type should be created.
     - `description`: A short description of the ticket type.
     - `emoji`: An emoji representing the ticket type.

   - **targetChannelId**: Channel ID to send copies of closed tickets.
   - **allowedUserId**: Specify a user ID if only a specific user can close tickets, or leave empty (`""`) to allow any member of the server to close tickets.
   - **clientId**: The bot's client ID.
   - **guildId**: The server ID.
   - **transcriptChannelId**: Channel ID to automatically send created ticket messages.

--- 
