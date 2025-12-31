}

  room.state = "playing";
  room.meeting = null;

  const wc = winCheck(room);
  if (wc.ended) {
    room.state = "ended";
    await ctx.reply(🏁 Game Over! Winner: ${wc.winner});
  }
});

bot.command("end", async (ctx) => {
  if (!isGroup(ctx)) return ctx.reply("⚠️ group में use करो.");
  const chatId = String(ctx.chat.id);
  const room = rooms.get(chatId);
  if (!room) return ctx.reply("No room.");
  if (ctx.from.id !== room.hostId) return ctx.reply("❌ Only host can end.");
  rooms.delete(chatId);
  await ctx.reply("🧹 Room ended.");
});

bot.launch();
console.log("AmongUs bot running...");
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
