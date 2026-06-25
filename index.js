require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const http = require("http");

// --- CONFIG ---
const TOKEN = process.env.BOT_TOKEN;
const APP_CHANNEL_ID = process.env.APPLICATION_CHANNEL_ID;
const AUTHORIZED_ROLE_IDS = [
  "1441894661332406402", // Co-Owner role
  "1387903334744064173", // Owner role
];

// ====== DRIVER COUNT CONFIG (new) ======
const GUILD_ID = "1387897307361575215";
const DRIVER_ROLE_ID = "1387898569779839127";
const TRAINEE_ROLE_ID = "1431731010810413157";

let driverCountCache = {
  drivers: 0,
  trainees: 0,
  total: 0,
  updated: null,
};

async function refreshDriverCount() {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.warn("[drivers] Guild not in cache, skipping refresh");
      return;
    }
    // Pull all members so role.members is fully populated
    await guild.members.fetch();

    const driverRole = guild.roles.cache.get(DRIVER_ROLE_ID);
    const traineeRole = guild.roles.cache.get(TRAINEE_ROLE_ID);
    const drivers = driverRole ? driverRole.members.size : 0;
    const trainees = traineeRole ? traineeRole.members.size : 0;

    driverCountCache = {
      drivers,
      trainees,
      total: drivers + trainees,
      updated: new Date().toISOString(),
    };
    console.log(
      `[drivers] Refreshed: ${drivers} drivers, ${trainees} trainees`
    );
  } catch (err) {
    console.error("[drivers] Refresh failed:", err);
  }
}

// ====== HTTP SERVER ======
// Health check + /drivers.json endpoint for the website
http
  .createServer((req, res) => {
    if (req.url === "/drivers.json") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // allow website fetch
        "Cache-Control": "public, max-age=30",
      });
      return res.end(JSON.stringify(driverCountCache));
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is alive");
  })
  .listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log(`HTTP server listening on ${process.env.PORT || 3000}`);
  });

function isAuthorized(member) {
  return member.roles.cache.some((r) => AUTHORIZED_ROLE_IDS.includes(r.id));
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    http.get(SELF_URL).on("error", () => {});
  }, 4 * 60 * 1000);
}

// ——— Register slash command + start driver count refresh on ready ———
client.once("ready", async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);

  const command = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Post the VTC application panel in this channel");

  const rest = new REST().setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: [command.toJSON()],
  });
  console.log("Slash command registered.");

  // Start driver count cache + refresh loop
  await refreshDriverCount();
  setInterval(refreshDriverCount, 60 * 1000); // every 60s
});

// ——— Interaction handler ———
client.on("interactionCreate", async (interaction) => {
  // /setup command
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    if (!isAuthorized(interaction.member))
      return interaction.reply({ content: "No permission.", ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle("🚛 VTC Application")
      .setDescription(
        "Want to join our VTC? Click the button below to apply!\n\n" +
          "**Before applying, make sure you have:**\n" +
          "• Read all the rules\n" +
          "• A reasonable amount of hours in ETS2\n" +
          "• Understood our policy on leaked mods"
      )
      .setColor(0x0035aa);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("vtc_apply")
        .setLabel("Apply to VTC")
        .setEmoji("📝")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({
      content: "✅ Application panel posted!",
      ephemeral: true,
    });
  }

  // Apply button → show modal
  if (interaction.isButton() && interaction.customId === "vtc_apply") {
    const modal = new ModalBuilder()
      .setCustomId("vtc_modal")
      .setTitle("VTC Application")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("age")
            .setLabel("How old are you?")
            .setPlaceholder("e.g. 18")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(3)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("hours")
            .setLabel("How many hours do you have on ETS2?")
            .setPlaceholder("e.g. 500")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(10)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Why do you want to join our VTC?")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("rule9")
            .setLabel("Have you read the rules? What is Rule 9?")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("leaks")
            .setLabel("Leaked / VTC mod policy agreement")
            .setPlaceholder("Type 'I agree' — you won't leak or discuss leaked mods")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(200)
            .setRequired(true)
        )
      );

    return interaction.showModal(modal);
  }

  // Modal submit → post application
  if (interaction.isModalSubmit() && interaction.customId === "vtc_modal") {
    const age = interaction.fields.getTextInputValue("age");
    const hours = interaction.fields.getTextInputValue("hours");
    const reason = interaction.fields.getTextInputValue("reason");
    const rule9 = interaction.fields.getTextInputValue("rule9");
    const leaks = interaction.fields.getTextInputValue("leaks");

    const channel = client.channels.cache.get(APP_CHANNEL_ID);
    if (!channel)
      return interaction.reply({
        content: "⚠️ Application channel not found. Contact an admin.",
        ephemeral: true,
      });

    const embed = new EmbedBuilder()
      .setTitle("📋 New VTC Application")
      .setColor(0x0035aa)
      .setAuthor({
        name: interaction.user.tag,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .addFields(
        { name: "Applicant", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Age", value: age, inline: true },
        { name: "ETS2 Hours", value: hours, inline: true },
        { name: "Reason for Joining", value: reason, inline: false },
        { name: "Rules / Rule 9 Answer", value: rule9, inline: false },
        { name: "Leak Policy Agreement", value: leaks, inline: false }
      )
      .setFooter({ text: `User ID: ${interaction.user.id}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`accept_${interaction.user.id}`)
        .setLabel("Accept")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`deny_${interaction.user.id}`)
        .setLabel("Deny")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({
      content: "✅ Your application has been submitted! Please wait for a response.",
      ephemeral: true,
    });
  }

  // Accept button
  if (interaction.isButton() && interaction.customId.startsWith("accept_")) {
    if (!isAuthorized(interaction.member))
      return interaction.reply({ content: "No permission.", ephemeral: true });

    const applicantId = interaction.customId.split("_")[1];
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setTitle("✅ Application ACCEPTED")
      .setColor(0x38a169)
      .addFields({
        name: "Reviewed by",
        value: `<@${interaction.user.id}>`,
        inline: false,
      });

    await interaction.message.edit({ embeds: [embed], components: [] });

    try {
      const applicant = await interaction.guild.members.fetch(applicantId);
      await applicant.roles.add("1431731010810413157"); // Trainee Driver role
      await applicant.send(
        "🎉 **Congratulations!** Your VTC application has been **accepted**! Welcome to the team!"
      );
      // Refresh count immediately so the website updates promptly
      refreshDriverCount();
    } catch (_) {}

    return interaction.reply({
      content: `Application for <@${applicantId}> accepted.`,
      ephemeral: true,
    });
  }

  // Deny button → show reason modal
  if (interaction.isButton() && interaction.customId.startsWith("deny_")) {
    if (!isAuthorized(interaction.member))
      return interaction.reply({ content: "No permission.", ephemeral: true });

    const applicantId = interaction.customId.split("_")[1];
    const modal = new ModalBuilder()
      .setCustomId(`deny_reason_${applicantId}_${interaction.message.id}`)
      .setTitle("Deny Application")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("deny_reason")
            .setLabel("Reason for denial (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(false)
        )
      );

    return interaction.showModal(modal);
  }

  // Deny reason modal submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith("deny_reason_")) {
    const parts = interaction.customId.split("_"); // deny_reason_USERID_MSGID
    const applicantId = parts[2];
    const messageId = parts[3];
    const reason = interaction.fields.getTextInputValue("deny_reason");

    const channel = client.channels.cache.get(APP_CHANNEL_ID);
    const msg = await channel.messages.fetch(messageId);

    const embed = EmbedBuilder.from(msg.embeds[0])
      .setTitle("❌ Application DENIED")
      .setColor(0xe53e3e)
      .addFields({
        name: "Reviewed by",
        value: `<@${interaction.user.id}>`,
        inline: false,
      });

    if (reason) embed.addFields({ name: "Denial Reason", value: reason, inline: false });

    await msg.edit({ embeds: [embed], components: [] });

    try {
      const applicant = await interaction.guild.members.fetch(applicantId);
      let dm = "😔 Unfortunately your VTC application has been **denied**.";
      if (reason) dm += `\n**Reason:** ${reason}`;
      await applicant.send(dm);
    } catch (_) {}

    return interaction.reply({
      content: `Application for <@${applicantId}> denied.`,
      ephemeral: true,
    });
  }
});

// Keep cache in sync when roles change (immediate, not waiting for the 60s tick)
client.on("guildMemberUpdate", (oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;
  const oldHas = (id) => oldMember.roles.cache.has(id);
  const newHas = (id) => newMember.roles.cache.has(id);
  if (
    oldHas(DRIVER_ROLE_ID) !== newHas(DRIVER_ROLE_ID) ||
    oldHas(TRAINEE_ROLE_ID) !== newHas(TRAINEE_ROLE_ID)
  ) {
    refreshDriverCount();
  }
});

client.on("guildMemberRemove", (member) => {
  if (member.guild.id !== GUILD_ID) return;
  if (
    member.roles.cache.has(DRIVER_ROLE_ID) ||
    member.roles.cache.has(TRAINEE_ROLE_ID)
  ) {
    refreshDriverCount();
  }
});

client.login(TOKEN);
