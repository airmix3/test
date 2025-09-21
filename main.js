const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("title");
const overlayMessage = document.getElementById("message");
const overlayPrompt = document.getElementById("prompt");

const TILE_SIZE = 48;
const PLAYER_WIDTH = 36;
const PLAYER_HEIGHT = 44;
const GRAVITY = 2200;
const MOVE_SPEED = 260;
const JUMP_SPEED = 900;
const MAX_FALL_SPEED = 1200;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.12;

const RAW_LEVEL = [
  "                                                                                                                ",
  "                                                                                                                ",
  "                                                                                                                ",
  "                                                                                                                ",
  "                               o   ?                                                                            ",
  "                          ###                                                                                   ",
  "                                                                                                                ",
  "               ###                                                                                              ",
  "                                                                                                                ",
  "       ?                                                                                                        ",
  " ###        o                                                                                                   ",
  "                                                                                                                ",
  "P    G           ###                G                         ###                           F                   ",
  "################################################################################################################"
];

let level = [];
let levelWidth = 0;
let levelHeight = RAW_LEVEL.length;
let worldWidth = 0;
let worldHeight = 0;

let player;
let goombas = [];
let coins = [];
let poppedCoins = [];
let floatingTexts = [];
let goal = null;

let coinsCollected = 0;
let score = 0;
let timeElapsed = 0;

let gameState = "ready";
const keys = { left: false, right: false };
const camera = { x: 0, y: 0 };

function buildWorld() {
  const maxWidth = Math.max(...RAW_LEVEL.map((row) => row.length));
  const paddedRows = RAW_LEVEL.map((row) => row.padEnd(maxWidth, " "));
  level = paddedRows.map((row) => row.split(""));
  levelWidth = maxWidth;
  levelHeight = level.length;
  worldWidth = levelWidth * TILE_SIZE;
  worldHeight = levelHeight * TILE_SIZE;

  goombas = [];
  coins = [];
  poppedCoins = [];
  floatingTexts = [];
  goal = null;

  let spawnX = TILE_SIZE;
  let spawnY = TILE_SIZE;

  for (let row = 0; row < levelHeight; row++) {
    for (let col = 0; col < levelWidth; col++) {
      const char = level[row][col];
      switch (char) {
        case "P": {
          spawnX = col * TILE_SIZE + (TILE_SIZE - PLAYER_WIDTH) / 2;
          spawnY = (row + 1) * TILE_SIZE - PLAYER_HEIGHT;
          level[row][col] = " ";
          break;
        }
        case "G": {
          const width = 40;
          const height = 40;
          goombas.push({
            x: col * TILE_SIZE + (TILE_SIZE - width) / 2,
            y: (row + 1) * TILE_SIZE - height,
            width,
            height,
            vx: -35,
            vy: 0,
            speed: 35,
            direction: -1,
            stomped: false
          });
          level[row][col] = " ";
          break;
        }
        case "o": {
          coins.push({
            x: col * TILE_SIZE + TILE_SIZE / 2,
            y: row * TILE_SIZE + TILE_SIZE / 2,
            radius: 12,
            collected: false,
            bob: Math.random() * Math.PI * 2
          });
          level[row][col] = " ";
          break;
        }
        case "F": {
          const baseY = (row + 1) * TILE_SIZE;
          const height = TILE_SIZE * 5.5;
          goal = {
            x: col * TILE_SIZE + TILE_SIZE / 2 - 6,
            width: 12,
            height,
            baseY,
            get y() {
              return this.baseY - this.height;
            }
          };
          level[row][col] = " ";
          break;
        }
        default:
          break;
      }
    }
  }

  player = {
    x: spawnX,
    y: spawnY,
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    vx: 0,
    vy: 0,
    onGround: false,
    jumpBuffer: 0,
    coyoteTime: 0,
    facing: 1
  };

  coinsCollected = 0;
  score = 0;
  timeElapsed = 0;
  camera.x = 0;
}

function setGameState(state) {
  gameState = state;
  if (state === "playing") {
    overlay.classList.add("hidden");
    return;
  }

  overlay.classList.remove("hidden");
  switch (state) {
    case "ready":
      overlayTitle.textContent = "Super Mini Mario";
      overlayMessage.textContent = "Use the arrow keys to run and jump. Reach the flag to win!";
      overlayPrompt.innerHTML = "Press <strong>Space</strong> to start.";
      break;
    case "dead":
      overlayTitle.textContent = "Mario Down!";
      overlayMessage.textContent = `Score: ${score}  —  Coins: ${coinsCollected}`;
      overlayPrompt.innerHTML = "Press <strong>Space</strong> to retry.";
      break;
    case "win":
      overlayTitle.textContent = "You Win!";
      overlayMessage.textContent = `Coins: ${coinsCollected}  —  Score: ${score}  —  Time: ${Math.floor(timeElapsed)}s`;
      overlayPrompt.innerHTML = "Press <strong>Space</strong> to play again.";
      break;
    default:
      break;
  }
}

function restart() {
  buildWorld();
  setGameState("ready");
}

function beginPlay() {
  if (gameState !== "playing") {
    buildWorld();
  }
  player.vx = 0;
  player.vy = 0;
  player.coyoteTime = 0;
  player.jumpBuffer = 0;
  setGameState("playing");
}

function tileAt(col, row) {
  if (col < 0 || col >= levelWidth) return "#";
  if (row < 0) return " ";
  if (row >= levelHeight) return "#";
  return level[row][col];
}

function isSolidTile(char) {
  return char === "#" || char === "?" || char === "!" || char === "B";
}

function getTileBounds(entity) {
  const left = Math.floor(entity.x / TILE_SIZE);
  const right = Math.floor((entity.x + entity.width - 1) / TILE_SIZE);
  const top = Math.floor(entity.y / TILE_SIZE);
  const bottom = Math.floor((entity.y + entity.height - 1) / TILE_SIZE);
  return { left, right, top, bottom };
}

function handleHorizontalCollisions(entity, type) {
  if (entity.vx === 0) return;
  const bounds = getTileBounds(entity);
  let collided = false;

  if (entity.vx > 0) {
    const col = Math.floor((entity.x + entity.width - 1) / TILE_SIZE);
    for (let row = bounds.top; row <= bounds.bottom; row++) {
      const tile = tileAt(col, row);
      if (isSolidTile(tile)) {
        entity.x = col * TILE_SIZE - entity.width - 0.01;
        entity.vx = 0;
        collided = true;
        break;
      }
    }
  } else if (entity.vx < 0) {
    const col = Math.floor(entity.x / TILE_SIZE);
    for (let row = bounds.top; row <= bounds.bottom; row++) {
      const tile = tileAt(col, row);
      if (isSolidTile(tile)) {
        entity.x = (col + 1) * TILE_SIZE + 0.01;
        entity.vx = 0;
        collided = true;
        break;
      }
    }
  }

  if (collided && type === "enemy") {
    entity.direction *= -1;
    entity.vx = entity.direction * entity.speed;
  }
}

function handleVerticalCollisions(entity, type) {
  const bounds = getTileBounds(entity);
  let collided = false;

  if (entity.vy > 0) {
    const row = Math.floor((entity.y + entity.height - 1) / TILE_SIZE);
    for (let col = bounds.left; col <= bounds.right; col++) {
      const tile = tileAt(col, row);
      if (isSolidTile(tile)) {
        entity.y = row * TILE_SIZE - entity.height;
        entity.vy = 0;
        collided = true;
        if (type === "player") {
          entity.onGround = true;
          entity.coyoteTime = COYOTE_TIME;
        }
        break;
      }
    }
  } else if (entity.vy < 0) {
    const row = Math.floor(entity.y / TILE_SIZE);
    for (let col = bounds.left; col <= bounds.right; col++) {
      const tile = tileAt(col, row);
      if (isSolidTile(tile)) {
        entity.y = (row + 1) * TILE_SIZE + 0.01;
        entity.vy = 0;
        collided = true;
        if (type === "player") {
          onHeadBump(row, col, tile);
        }
        break;
      }
    }
  }

  if (type === "player" && !collided && entity.onGround) {
    entity.onGround = false;
  }
}

function onHeadBump(row, col, tile) {
  if (tile === "?") {
    level[row][col] = "!";
    coinsCollected += 1;
    score += 200;
    spawnFloatingText("+200", col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE - 12);
    spawnPoppedCoin(col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE / 2);
  }
}

function spawnPoppedCoin(x, y) {
  poppedCoins.push({ x, y, vy: -320, life: 0 });
}

function spawnFloatingText(text, x, y) {
  floatingTexts.push({ text, x, y, life: 0 });
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function collectCoin(coin) {
  coin.collected = true;
  coinsCollected += 1;
  score += 100;
  spawnFloatingText("+100", coin.x, coin.y - 30);
}

function stompGoomba(goomba) {
  goomba.stomped = true;
  score += 200;
  spawnFloatingText("+200", goomba.x + goomba.width / 2, goomba.y);
}

function onPlayerDeath() {
  setGameState("dead");
}

function onPlayerWin() {
  setGameState("win");
}

function updatePlayer(delta) {
  player.jumpBuffer = Math.max(0, player.jumpBuffer - delta);
  player.coyoteTime = Math.max(0, player.coyoteTime - delta);

  const prevBottom = player.y + player.height;

  let direction = 0;
  if (keys.left) direction -= 1;
  if (keys.right) direction += 1;
  player.vx = direction * MOVE_SPEED;
  if (direction !== 0) {
    player.facing = direction;
  }

  player.x += player.vx * delta;
  handleHorizontalCollisions(player, "player");

  player.vy += GRAVITY * delta;
  if (player.vy > MAX_FALL_SPEED) player.vy = MAX_FALL_SPEED;
  player.y += player.vy * delta;
  handleVerticalCollisions(player, "player");

  if (player.jumpBuffer > 0 && player.coyoteTime > 0) {
    player.vy = -JUMP_SPEED;
    player.onGround = false;
    player.coyoteTime = 0;
    player.jumpBuffer = 0;
  }

  if (player.y > worldHeight + TILE_SIZE) {
    onPlayerDeath();
  }

  player.prevBottom = prevBottom;
  player.x = Math.max(0, Math.min(player.x, worldWidth - player.width));
}

function updateGoombas(delta) {
  for (const goomba of goombas) {
    if (goomba.stomped) continue;

    goomba.vy += GRAVITY * delta;
    if (goomba.vy > MAX_FALL_SPEED) goomba.vy = MAX_FALL_SPEED;

    goomba.x += goomba.vx * delta;
    handleHorizontalCollisions(goomba, "enemy");

    goomba.y += goomba.vy * delta;
    handleVerticalCollisions(goomba, "enemy");

    if (goomba.y > worldHeight + TILE_SIZE) {
      goomba.stomped = true;
    }
  }

  goombas = goombas.filter((g) => !g.stomped);
}

function updateCoins(delta) {
  for (const coin of coins) {
    if (coin.collected) continue;
    coin.bob += delta * 2;
    const coinBox = {
      x: coin.x - 16,
      y: coin.y - 16,
      width: 32,
      height: 32
    };
    if (overlaps(player, coinBox)) {
      collectCoin(coin);
    }
  }
}

function updatePoppedCoins(delta) {
  for (const coin of poppedCoins) {
    coin.life += delta;
    coin.y += coin.vy * delta;
    coin.vy += GRAVITY * delta * 0.6;
  }
  poppedCoins = poppedCoins.filter((coin) => coin.life < 0.6);
}

function updateFloatingTexts(delta) {
  for (const text of floatingTexts) {
    text.life += delta;
    text.y -= delta * 60;
  }
  floatingTexts = floatingTexts.filter((text) => text.life < 1.1);
}

function updateGoal() {
  if (!goal) return;
  const goalBox = {
    x: goal.x,
    y: goal.y,
    width: goal.width,
    height: goal.height
  };
  if (overlaps(player, goalBox)) {
    onPlayerWin();
  }
}

function updateInteractions() {
  for (const goomba of goombas) {
    if (player.y + player.height <= goomba.y + 5) continue;
    if (!overlaps(player, goomba)) continue;

    if (player.prevBottom <= goomba.y + goomba.height * 0.2 && player.vy > 0) {
      stompGoomba(goomba);
      player.vy = -JUMP_SPEED * 0.55;
    } else {
      onPlayerDeath();
    }
  }
}

function update(delta) {
  timeElapsed += delta;

  updatePlayer(delta);
  updateGoombas(delta);
  updateCoins(delta);
  updatePoppedCoins(delta);
  updateFloatingTexts(delta);
  updateInteractions();
  updateGoal();

  if (gameState === "playing") {
    const target = player.x + player.width / 2 - canvas.width / 2;
    const maxX = Math.max(0, worldWidth - canvas.width);
    camera.x += (Math.max(0, Math.min(target, maxX)) - camera.x) * 0.12;
  }
}

function drawBackground() {
  ctx.fillStyle = "#87ceeb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x * 0.5, 0);
  ctx.fillStyle = "#f0d9a0";
  ctx.beginPath();
  ctx.moveTo(0, canvas.height - 60);
  ctx.lineTo(canvas.width * 2, canvas.height - 120);
  ctx.lineTo(canvas.width * 2, canvas.height);
  ctx.lineTo(0, canvas.height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTiles() {
  const startCol = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const endCol = Math.min(
    levelWidth - 1,
    Math.floor((camera.x + canvas.width) / TILE_SIZE) + 1
  );

  for (let row = 0; row < levelHeight; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const tile = level[row][col];
      if (!tile.trim()) continue;

      const x = col * TILE_SIZE - camera.x;
      const y = row * TILE_SIZE;

      if (tile === "#") {
        ctx.fillStyle = "#8b4513";
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = "#a86a3d";
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE / 5);
      } else if (tile === "?") {
        ctx.fillStyle = "#f6d32d";
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = "#c2850a";
        ctx.fillRect(x + 8, y + 8, TILE_SIZE - 16, TILE_SIZE - 16);
        ctx.fillStyle = "#ffe680";
        ctx.font = "24px 'Press Start 2P', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("?", x + TILE_SIZE / 2, y + TILE_SIZE / 2 + 8);
      } else if (tile === "!") {
        ctx.fillStyle = "#d6a53c";
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = "#b17b24";
        ctx.fillRect(x + 8, y + 8, TILE_SIZE - 16, TILE_SIZE - 16);
      }
    }
  }
}

function drawCoins() {
  for (const coin of coins) {
    if (coin.collected) continue;
    const bobOffset = Math.sin(coin.bob) * 6;
    const x = coin.x - camera.x;
    const y = coin.y + bobOffset;
    ctx.fillStyle = "#ffd966";
    ctx.beginPath();
    ctx.ellipse(x, y, coin.radius, coin.radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f1a602";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, coin.radius - 4, (coin.radius - 4) * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const coin of poppedCoins) {
    const progress = coin.life / 0.6;
    const alpha = Math.max(0, 1 - progress);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffe27a";
    ctx.beginPath();
    ctx.ellipse(coin.x - camera.x, coin.y, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawGoombas() {
  for (const goomba of goombas) {
    if (goomba.stomped) continue;
    const x = goomba.x - camera.x;
    const y = goomba.y;
    ctx.fillStyle = "#8b4a2f";
    ctx.fillRect(x, y + goomba.height / 2, goomba.width, goomba.height / 2);
    ctx.beginPath();
    ctx.ellipse(x + goomba.width / 2, y + goomba.height / 2, goomba.width / 2, goomba.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(x + goomba.width / 2 - 6, y + goomba.height / 2 - 4, 6, 8, 0, 0, Math.PI * 2);
    ctx.ellipse(x + goomba.width / 2 + 6, y + goomba.height / 2 - 4, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(x + goomba.width / 2 - 6, y + goomba.height / 2 - 4, 3, 0, Math.PI * 2);
    ctx.arc(x + goomba.width / 2 + 6, y + goomba.height / 2 - 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGoal() {
  if (!goal) return;
  const poleX = goal.x - camera.x + goal.width / 2 - 2;
  const poleTop = goal.y;
  const poleBottom = goal.baseY;

  ctx.strokeStyle = "#d0d0d0";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(poleX, poleTop);
  ctx.lineTo(poleX, poleBottom);
  ctx.stroke();

  ctx.fillStyle = "#3c9c3c";
  ctx.beginPath();
  ctx.moveTo(poleX, poleTop + 20);
  ctx.lineTo(poleX + 42, poleTop + 32);
  ctx.lineTo(poleX, poleTop + 44);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(poleX, poleTop, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer() {
  const x = player.x - camera.x;
  const y = player.y;
  ctx.fillStyle = "#fbd7c3";
  ctx.fillRect(x + 10, y, player.width - 20, player.height - 26);
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(x + 6, y + 10, player.width - 12, 14);
  ctx.fillRect(x, y + player.height - 18, player.width, 18);
  ctx.fillStyle = "#1f4aa8";
  ctx.fillRect(x + 6, y + 24, player.width - 12, player.height - 42);
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y + player.height - 8, player.width, 8);
}

function drawHud() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(14, 34, 63, 0.65)";
  ctx.fillRect(20, 20, 260, 110);
  ctx.fillStyle = "#fff";
  ctx.font = "20px 'Press Start 2P', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`COINS: ${coinsCollected}`, 32, 52);
  ctx.fillText(`SCORE: ${score}`, 32, 80);
  ctx.fillText(`TIME: ${Math.floor(timeElapsed)}`, 32, 108);
  ctx.restore();
}

function drawFloatingText() {
  for (const text of floatingTexts) {
    const alpha = Math.max(0, 1 - text.life / 1.1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff";
    ctx.font = "18px 'Press Start 2P', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text.text, text.x - camera.x, text.y);
    ctx.globalAlpha = 1;
  }
}

function render() {
  drawBackground();

  drawTiles();
  drawCoins();
  drawGoombas();
  drawGoal();
  drawFloatingText();
  drawPlayer();

  drawHud();
}

function loop(timestamp) {
  if (!loop.lastTime) loop.lastTime = timestamp;
  const delta = Math.min((timestamp - loop.lastTime) / 1000, 0.05);
  loop.lastTime = timestamp;

  if (gameState === "playing") {
    update(delta);
  }

  render();
  requestAnimationFrame(loop);
}

function handleKeyDown(event) {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(event.code)) {
    event.preventDefault();
  }

  if (gameState === "ready" && event.code === "Space") {
    beginPlay();
    return;
  }

  if ((gameState === "dead" || gameState === "win") && event.code === "Space") {
    beginPlay();
    return;
  }

  if (gameState !== "playing") return;

  if (event.code === "ArrowLeft") keys.left = true;
  if (event.code === "ArrowRight") keys.right = true;
  if (event.code === "ArrowUp" || event.code === "Space") {
    player.jumpBuffer = JUMP_BUFFER;
  }
}

function handleKeyUp(event) {
  if (event.code === "ArrowLeft") keys.left = false;
  if (event.code === "ArrowRight") keys.right = false;
  if (event.code === "ArrowUp" || event.code === "Space") {
    if (player.vy < -JUMP_SPEED * 0.55) {
      player.vy = -JUMP_SPEED * 0.55;
    }
  }
}

window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);

restart();
requestAnimationFrame(loop);
