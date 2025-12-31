import "dotenv/config";
import { Telegraf, Markup } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);

// rooms store
const rooms = new Map();

function randCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function isGroup(ctx) {
  const t = ctx.chat?.type;
  return t === "group"  t === "supergroup";
}

function mention(u) {
  const name = (u.first_name  "Player").replace(/[<>]/g, "");
  return @${u.username || name};
}

function ensureRoom(chatId, hostId) {
  if (!rooms.has(chatId)) {
    rooms.set(chatId, {
      state: "lobby",
      hostId,
      code: randCode(),
      players: new Map(),
      impostors: new Set(),
      meeting: null,
    });
  }
  return rooms.get(chatId);
}

function alivePlayers(room) {
  return [...room.players.values()].filter((p) => p.alive);
}
function aliveImpostors(room) {
  return [...room.players.values()].filter((p) => p.alive && p.role === "impostor");
}
function aliveCrew(room) {
  return [...room.players.values()].filter((p) => p.alive && p.role === "crew");
}

function neededImpostors(n) {
  return n >= 8 ? 2 : 1;
}

function winCheck(room) {
  const imp = aliveImpostors(room).length;
  const crew = aliveCrew(room).length;
  if (imp === 0) return { ended: true, winner: "CREW" };
  if (imp >= crew) return { ended: true, winner: "IMPOSTORS" };
  return { ended: false };
}

async function safeDM(ctx, userId, text) {
  try {
    await ctx.telegram.sendMessage(userId, text);
    return true;
  } catch {
    return false;
  }
}

bot.start(async (ctx) => {
  await ctx.reply(
    "🛸 AmongUs Bot\n\nGroup में add करो.\nCommands:\n/create\n/join\n/leave\n/begin\n/kill\n/meeting\n/status\n/end"
  );
});

bot.command("create", async (ctx) => {
  if (!isGroup(ctx)) return ctx.reply("⚠️ ये command group में use करो.");
  const chatId = String(ctx.chat.id);
  const room = ensureRoom(chatId, ctx.from.id);

  room.state = "lobby";
  room.hostId = ctx.from.id;
  room.code = randCode();
  room.players.clear();
  room.impostors.clear();
  room.meeting = null;

  room.players.set(ctx.from.id, { id: ctx.from.id, name: mention(ctx.from), alive: true, role: "crew" });

  await ctx.reply(
    ✅ Room created!\nCode: ${room.code}\n\nUse /join then /begin (host).
  );
});

bot.command("join", async (ctx) => {
  if (!isGroup(ctx)) return ctx.reply("⚠️ group में use करो.");
  const chatId = String(ctx.chat.id);
  const room = rooms.get(chatId);
  if (!room) return ctx.reply("❌ पहले /create करो.");
  if (room.state !== "lobby") return ctx.reply("❌ Game already started.");
  if (room.players.has(ctx.from.id)) return ctx.reply("✅ Already joined.");
  if (room.players.size >= 10) return ctx.reply("❌ Max 10 players.");

  room.players.set(ctx.from.id, { id: ctx.from.id, name: mention(ctx.from), alive: true, role: "crew" });
  await ctx.reply(✅ Joined. Players: ${room.players.size});
});

bot.command("leave", async (ctx) => {
  if (!isGroup(ctx)) return ctx.reply("⚠️ group में use करो.");
  const chatId = String(ctx.chat.id);
  const room = rooms.get(chatId);
  if (!room) return ctx.reply("❌ No room.");
  room.players.delete(ctx.from.id);
  room.impostors.delete(ctx.from.id);
  await ctx.reply("👋 Left.");
});

bot.command("status", async (ctx) => {
  if (!isGroup(ctx)) return ctx.reply("⚠️ group में use करो.");
  const chatId = String(ctx.chat.id);
  const room = rooms.get(chatId);
  if (!room) return ctx.reply("❌ No room.");
  await ctx.reply(
    📟 State: ${room.state}\nPlayers: ${room.players.size}\nAlive: ${alivePlayers(room).length}\nImpostors alive: ${aliveImpostors(room).length}
  );
});

bot.command("begin", async (ctx) => {
  if (!isGroup(ctx)) return ctx.reply("⚠️ group में use करो.");
  const chatId = String(ctx.chat.id);
  const room = rooms.get(chatId);
  if (!room) return ctx.reply("❌ No room. /create");
  if (ctx.from.id !== room.hostId) return ctx.reply("❌ Only host can /begin");
  if (room.players.size < 4) return ctx.reply("❌ Minimum 4 players.");
const ids = [...room.players.keys()];
  // shuffle
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  const impCount = neededImpostors(ids.length);
  room.impostors = new Set(ids.slice(0, impCount));

  for (const [id, p] of room.players.entries()) {
    p.alive = true;
    p.role = room.impostors.has(id) ? "impostor" : "crew";
    room.players.set(id, p);
  }

  room.state = "playing";
  let dmFails = 0;
  for (const [id, p] of room.players.entries()) {
    const txt = p.role === "impostor" ? "🟥 You are IMPOSTOR." : "🟦 You are CREWMATE.";
    const ok = await safeDM(ctx, id, txt);
    if (!ok) dmFails++;
  }

  await ctx.reply(🚀 Started! Roles sent in DM. ${dmFails ? ⚠️ ${dmFails} DM failed (players should DM bot once). : ""});
});

bot.command("kill", async (ctx) => {
  if (!isGroup(ctx)) return ctx.reply("⚠️ group में use करो.");
  const chatId = String(ctx.chat.id);
  const room = rooms.get(chatId);
  if (!room  room.state !== "playing") return ctx.reply("❌ Game not running.");

  const me = room.players.get(ctx.from.id);
  if (!me  !me.alive) return ctx.reply("❌ You are not alive.");
  if (me.role !== "impostor") return ctx.reply("❌ Only impostor can kill.");

  const targets = alivePlayers(room).filter((p) => p.id !== ctx.from.id);
  const buttons = targets.map((p) => [Markup.button.callback(💀 ${p.name}, KILL:${p.id})]);
  await ctx.reply("Choose target:", Markup.inlineKeyboard(buttons));
});

bot.action(/KILL:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = String(ctx.chat.id);
  const room = rooms.get(chatId);
  if (!room  room.state !== "playing") return;

  const killer = room.players.get(ctx.from.id);
  if (!killer  !killer.alive  killer.role !== "impostor") return;

  const targetId = Number(ctx.match[1]);
  const target = room.players.get(targetId);
  if (!target  !target.alive) return;

  target.alive = false;
  room.players.set(targetId, target);

  await ctx.editMessageText(💥 ${target.name} eliminated! Call /meeting to vote.);

  const wc = winCheck(room);
  if (wc.ended) {
    room.state = "ended";
    await ctx.reply(🏁 Game Over! Winner: ${wc.winner});
  }
});

bot.command("meeting", async (ctx) => {
  if (!isGroup(ctx)) return ctx.reply("⚠️ group में use करो.");
  const chatId = String(ctx.chat.id);
  const room = rooms.get(chatId);
  if (!room || room.state !== "playing") return ctx.reply("❌ Game not running.");

  room.state = "meeting";
  room.meeting = { votes: new Map() };

  const alive = alivePlayers(room);
  const buttons = alive.map((p) => [Markup.button.callback(🗳️ Vote ${p.name}, VOTE:${p.id})]);
  buttons.push([Markup.button.callback("⏭️ Skip", "VOTE:SKIP")]);

  await ctx.reply("📢 MEETING! Tap vote:", Markup.inlineKeyboard(buttons));
});

bot.action(/VOTE:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = String(ctx.chat.id);
  const room = rooms.get(chatId);
  if (!room  room.state !== "meeting"  !room.meeting) return;

  const voter = room.players.get(ctx.from.id);
  if (!voter || !voter.alive) return;

  room.meeting.votes.set(ctx.from.id, ctx.match[1]);

  const aliveCount = alivePlayers(room).length;
  const voted = room.meeting.votes.size;

  if (voted < aliveCount) return ctx.reply(✅ Vote received (${voted}/${aliveCount}));

  // tally
  const tally = new Map();
  for (const v of room.meeting.votes.values()) tally.set(v, (tally.get(v)  0) + 1);

  let maxTarget = null, maxVotes = 0, tie = false;
  for (const [t, c] of tally.entries()) {
    if (c > maxVotes) { maxVotes = c; maxTarget = t; tie = false; }
    else if (c === maxVotes) tie = true;
  }

  if (!maxTarget  tie || maxTarget === "SKIP") {
    room.state = "playing";
    room.meeting = null;
    return ctx.reply("😶 No one ejected. (Tie/Skip)");
  }

  const ejectedId = Number(maxTarget);
  const ejected = room.players.get(ejectedId);
  if (ejected && ejected.alive) {
    ejected.alive = false;
    room.players.set(ejectedId, ejected);
    await ctx.reply(🚪 ${ejected.name} was ejected!);}

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
