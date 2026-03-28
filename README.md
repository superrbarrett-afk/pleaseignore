# 🎪 Five Nights at Freddy's — Multiplayer

A local multiplayer FNAF experience built with Node.js + Socket.io.

---

## ⚡ SETUP (one time)

**You need Node.js installed.** Download from: https://nodejs.org

```bash
# 1. Open a terminal in this folder
# 2. Install dependencies
npm install

# 3. Start the server
npm start
# OR: node server.js
```

---

## 🎮 HOW TO PLAY

1. **Start the server** (see above). You'll see:
   ```
   🎮 FNAF Multiplayer Server RUNNING
      http://localhost:3000
   ```

2. **Everyone on the same network** opens: `http://localhost:3000`
   - The host uses their own IP address (e.g. `http://192.168.1.X:3000`)
   - Others on the same Wi-Fi can use the host's IP too

3. **Host creates a room** with a custom code (e.g. `FNAF1993`)
4. **Others join** using that code
5. **Everyone picks a role**, then host clicks **START GAME**

---

## 🐻 ROLES

| Role | Spawn | Goal |
|------|-------|------|
| 🐻 Freddy | Front Area | Reach the Office |
| 🐥 Chica | Front Area | Reach the Office |
| 🐰 Bonnie | Front Area | Reach the Office |
| 🦊 Foxy | Foxy's Cove | Reach the Office (special ability) |
| 👮 Night Guard | Office | Survive until 6 AM |

**Minimum 2 players. At least 1 must be Night Guard.**

---

## 🗺️ MAP LAYOUT

```
FRONT AREA
├─ PORCH ──────── BEDROOM ─── FOXY'S COVE
├─ LIVING ROOM ── BEDROOM
│   └─ KITCHEN ─ /restricted/ (UPPER)
│                    └─ /restricted/ (LOWER)
│                           └─ OFFICE ← Night Guard
│                           └─ CHICKEN COOP
```

Animatronics must move **step by step** through adjacent rooms to reach the Office.

---

## ⏱️ MECHANICS

### Animatronics
- Can move **once every 10 seconds** (a "STEP" event)
- When STEP fires, you get a flashing alert — choose an adjacent room to move to
- **🦊 Foxy Special**: if the music box runs out, Foxy gets a **RUN** button that teleports them close to the office

### Night Guard
- Has **8 minutes of power** (bar shown top-left)
- Can **close the door** (SPACE key or button) — animatronics cannot enter while locked
- Must **wind the music box** (click CRANK) — each crank adds 3 seconds
  - If music box hits 0%, **Foxy can rush!**
  - Night guard gets a warning notification
- **BRB Button**: leave the office temporarily (game does NOT pause!)
  - Animatronics are notified you left
  - Type `admin` to return to your computer
  - Keep winding the music box from the BRB screen!
- If **power runs out**: hold the POWER button for 3 seconds to restore emergency power (25%)

### Win Conditions
- **Animatronics win**: any animatronic enters the Office while guard is inside
- **Night Guard wins**: survive until the **6 AM timer** reaches 0:00 (10 minutes)

---

## 🔧 TROUBLESHOOTING

- **Others can't connect?** Make sure your firewall allows port 3000, and use your local IP
- **Find your IP**: run `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
- **Port in use?** Change the port in `server.js` last line: `server.listen(3000, ...)`
