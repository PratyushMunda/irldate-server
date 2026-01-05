import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

const users = new Map();
const pairs = new Map();

/* utils */
function cellId(lat, lng) {
  return `${Math.floor(lat * 100)}:${Math.floor(lng * 100)}`;
}

/* presence + pairing */
app.post("/presence", (req, res) => {
  const { userId, lat, lng } = req.body;
  if (!userId || !lat || !lng) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const now = Date.now();
  const cell = cellId(lat, lng);

  let user = users.get(userId);
  if (!user) {
    user = { userId, cell, state: "WAITING", lastSeen: now };
    users.set(userId, user);
  }

  user.cell = cell;
  user.lastSeen = now;

  if (user.state === "PAIRED") {
    return res.json({ status: "PAIRED", pairId: user.pairId });
  }

  const candidates = [...users.values()]
    .filter(
      u =>
        u.userId !== userId &&
        u.state === "WAITING" &&
        u.cell === cell
    )
    .sort((a, b) => a.lastSeen - b.lastSeen);

  if (candidates.length === 0) {
    return res.json({ status: "WAITING" });
  }

  const partner = candidates[0];
  const pairId = randomUUID();

  const pair = {
    pairId,
    userA: userId,
    userB: partner.userId,
    decisions: {},
    expiresAt: now + 2 * 60 * 1000,
  };

  pairs.set(pairId, pair);

  user.state = "PAIRED";
  user.pairId = pairId;

  partner.state = "PAIRED";
  partner.pairId = pairId;

  return res.json({ status: "PAIRED", pairId });
});

/* accept / decline */
app.post("/decision", (req, res) => {
  const { pairId, userId, decision } = req.body;
  const pair = pairs.get(pairId);

  if (!pair) return res.json({ status: "EXPIRED" });

  pair.decisions[userId] = decision;

  const a = pair.decisions[pair.userA];
  const b = pair.decisions[pair.userB];

  if (a === "ACCEPT" && b === "ACCEPT") {
    cleanup(pairId);
    return res.json({ result: "MATCH_CONFIRMED" });
  }

  if (a === "DECLINE" || b === "DECLINE") {
    cleanup(pairId);
    return res.json({ result: "CANCELLED" });
  }

  return res.json({ status: "WAITING_OTHER" });
});

function cleanup(pairId) {
  const pair = pairs.get(pairId);
  if (!pair) return;

  [pair.userA, pair.userB].forEach(uid => {
    const u = users.get(uid);
    if (u) {
      u.state = "WAITING";
      u.pairId = null;
    }
  });

  pairs.delete(pairId);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("IRLDate server running on port", PORT);
});
