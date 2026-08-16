// ==UserScript==
// @name         MG Seed Deleter
// @author       Joshueke
// @namespace    MC-SeedDeleterMod
// @version      0.0.9
// @description  Bulk seed deleter for Magic Garden with a draggable panel, multi-species selection, and pause/resume/stop with live progress and ETA, extracted from Arie's Mod
// @match        https://1227719606223765687.discordsays.com/*
// @match        https://magiccircle.gg/r/*
// @match        https://magicgarden.gg/r/*
// @match        https://starweaver.org/r/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
(() => {
  // src/utils/page-context.ts
  var sandboxWin = window;
  var pageWin = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : sandboxWin;
  var pageWindow = pageWin;
  var isIsolatedContext = pageWin !== sandboxWin;
  function shareGlobal(name, value) {
    try {
      pageWin[name] = value;
    } catch {
    }
    if (isIsolatedContext) {
      try {
        sandboxWin[name] = value;
      } catch {
      }
    }
  }

  // src/core/state.ts
  var NativeWS = pageWindow.WebSocket;
  var NativeWorker = pageWindow.Worker;
  var sockets = [];
  var quinoaWS = null;
  function setQWS(ws, why) {
    if (!quinoaWS) {
      quinoaWS = ws;
      shareGlobal("quinoaWS", ws);
      try {
        console.log("[QuinoaWS] selected ->", why);
      } catch {
      }
    }
  }
  var Workers = typeof Set !== "undefined" ? /* @__PURE__ */ new Set() : {
    _a: [],
    add(w) {
      this._a.push(w);
    },
    delete(w) {
      const i = this._a.indexOf(w);
      if (i >= 0) this._a.splice(i, 1);
    },
    forEach(fn) {
      for (let i = 0; i < this._a.length; i++) fn(this._a[i]);
    }
  };

  // src/core/parse.ts
  async function parseWSData(d) {
    try {
      if (typeof d === "string") return JSON.parse(d);
      if (d instanceof Blob) return JSON.parse(await d.text());
      if (d instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(d));
    } catch {
    }
    return null;
  }

  // src/hooks/wsHook.ts
  function installPageWebSocketHook() {
    if (!pageWindow || !NativeWS) return;
    function WrappedWebSocket(url, protocols) {
      const ws = protocols !== void 0 ? new NativeWS(url, protocols) : new NativeWS(url);
      sockets.push(ws);
      ws.addEventListener("open", () => {
        setTimeout(() => {
          if (ws.readyState === NativeWS.OPEN) setQWS(ws, "open-fallback");
        }, 800);
      });
      ws.addEventListener("message", async (ev) => {
        const j = await parseWSData(ev.data);
        if (!j) return;
        if (j.type === "Welcome" || j.type === "Config" || j.fullState || j.config) {
          setQWS(ws, "message:" + (j.type || "state"));
        }
      });
      return ws;
    }
    WrappedWebSocket.prototype = NativeWS.prototype;
    try {
      WrappedWebSocket.OPEN = NativeWS.OPEN;
    } catch {
    }
    try {
      WrappedWebSocket.CLOSED = NativeWS.CLOSED;
    } catch {
    }
    try {
      WrappedWebSocket.CLOSING = NativeWS.CLOSING;
    } catch {
    }
    try {
      WrappedWebSocket.CONNECTING = NativeWS.CONNECTING;
    } catch {
    }
    pageWindow.WebSocket = WrappedWebSocket;
    if (pageWindow !== window) {
      try {
        window.WebSocket = WrappedWebSocket;
      } catch {
      }
    }
    const FALLBACK_DELAY_MS = 5e3;
    const win = pageWindow || (typeof window !== "undefined" ? window : null);
    if (win) {
      win.setTimeout(() => {
        try {
          const conn = win.MagicCircle_RoomConnection;
          const ws = conn?.currentWebSocket;
          if (ws && ws.readyState === NativeWS.OPEN) {
            setQWS(ws, "room-connection-fallback");
          }
        } catch {
        }
      }, FALLBACK_DELAY_MS);
    }
  }

  // src/ui/panel/dom.ts
  function setStyles(el, styles) {
    Object.assign(el.style, styles);
    return el;
  }

  // src/ui/panel/dragPosition.ts
  var DRAG_THRESHOLD_PX = 4;
  var VIEWPORT_MARGIN_PX = 4;
  function loadPosition(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      if (typeof parsed?.xFrac === "number" && typeof parsed?.yFrac === "number") return parsed;
    } catch {
    }
    return null;
  }
  function savePosition(key, pos) {
    try {
      localStorage.setItem(key, JSON.stringify(pos));
    } catch {
    }
  }
  function fracRange(size, viewportSize) {
    return Math.max(0, viewportSize - size - 2 * VIEWPORT_MARGIN_PX);
  }
  function fracToPx(pos, width, height) {
    return {
      left: VIEWPORT_MARGIN_PX + pos.xFrac * fracRange(width, window.innerWidth),
      top: VIEWPORT_MARGIN_PX + pos.yFrac * fracRange(height, window.innerHeight)
    };
  }
  function pxToFrac(left, top, width, height) {
    const rangeX = fracRange(width, window.innerWidth);
    const rangeY = fracRange(height, window.innerHeight);
    return {
      xFrac: rangeX > 0 ? Math.min(1, Math.max(0, (left - VIEWPORT_MARGIN_PX) / rangeX)) : 0,
      yFrac: rangeY > 0 ? Math.min(1, Math.max(0, (top - VIEWPORT_MARGIN_PX) / rangeY)) : 0
    };
  }
  function placeAt(root, left, top) {
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  }
  function restoreSavedPosition(root, storageKey) {
    const saved = loadPosition(storageKey);
    if (!saved) return;
    const r = root.getBoundingClientRect();
    const { left, top } = fracToPx(saved, r.width, r.height);
    placeAt(root, left, top);
  }
  function makeDraggable(root, handle, storageKey) {
    let dragging = false;
    let moved = false;
    let enabled = true;
    let ox = 0, oy = 0;
    let startX = 0, startY = 0;
    let width = 0, height = 0;
    handle.style.cursor = "grab";
    if (storageKey) {
      restoreSavedPosition(root, storageKey);
      window.addEventListener("resize", () => {
        if (enabled) restoreSavedPosition(root, storageKey);
      });
    }
    const onDown = (e) => {
      if (!enabled || e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const r = root.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      width = r.width;
      height = r.height;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp, { once: true });
    };
    const onMove = (e) => {
      if (!dragging) return;
      if (!moved) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
        moved = true;
        handle.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      const maxX = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX);
      const maxY = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - height - VIEWPORT_MARGIN_PX);
      const left = Math.min(Math.max(VIEWPORT_MARGIN_PX, e.clientX - ox), maxX);
      const top = Math.min(Math.max(VIEWPORT_MARGIN_PX, e.clientY - oy), maxY);
      placeAt(root, left, top);
    };
    const onUp = () => {
      dragging = false;
      handle.style.cursor = enabled ? "grab" : "pointer";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      if (moved && storageKey) {
        const r = root.getBoundingClientRect();
        savePosition(storageKey, pxToFrac(r.left, r.top, r.width, r.height));
      }
    };
    const onClickCapture = (e) => {
      if (moved) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    handle.addEventListener("mousedown", onDown);
    handle.addEventListener("click", onClickCapture, true);
    return {
      setEnabled(v) {
        enabled = v;
        handle.style.cursor = v ? "grab" : "pointer";
        if (v && storageKey) restoreSavedPosition(root, storageKey);
      }
    };
  }

  // src/ui/panel/toggleButton.ts
  var TOGGLE_ID = "qws-seeddeleter-toggle";
  var TOGGLE_POSITION_KEY = "mgSeedDeleter.togglePosition.v1";
  var TOGGLE_MODE_KEY = "mgSeedDeleter.toggleMode.v1";
  var TOGGLE_FIXED_LEFT_PX = 90;
  var TOGGLE_FIXED_BOTTOM_PX = 10;
  function loadToggleMode() {
    try {
      const stored = localStorage.getItem(TOGGLE_MODE_KEY);
      if (stored === "draggable" || stored === "fixed") return stored;
    } catch {
    }
    return "fixed";
  }
  function saveToggleMode(mode) {
    try {
      localStorage.setItem(TOGGLE_MODE_KEY, mode);
    } catch {
    }
  }
  function createToggleButton(onToggle) {
    const btn = document.createElement("button");
    btn.id = TOGGLE_ID;
    btn.textContent = "\u{1F331}";
    btn.title = "Seed deleter";
    setStyles(btn, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "999998",
      width: "32px",
      height: "32px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0",
      borderRadius: "8px",
      border: "1px solid #39424c",
      background: "rgba(22,27,34,0.92)",
      color: "#E7EEF7",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: "16px",
      fontWeight: "700",
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)"
    });
    const dragController = makeDraggable(btn, btn, TOGGLE_POSITION_KEY);
    btn.onclick = onToggle;
    let currentMode = loadToggleMode();
    btn.onmouseenter = () => {
      if (currentMode === "fixed") {
        btn.style.borderColor = "rgba(167, 139, 250, .35)";
        btn.style.background = "linear-gradient(rgba(167, 139, 250, .16), rgba(167, 139, 250, .16)), var(--gc-raised, #121219)";
      } else {
        btn.style.borderColor = "#6aa1";
      }
    };
    btn.onmouseleave = () => {
      if (currentMode === "fixed") {
        btn.style.borderColor = "transparent";
        btn.style.background = "#121219";
      } else {
        btn.style.borderColor = "#39424c";
      }
    };
    const setMode = (mode) => {
      currentMode = mode;
      dragController.setEnabled(mode === "draggable");
      if (mode === "fixed") {
        setStyles(btn, {
          left: `${TOGGLE_FIXED_LEFT_PX}px`,
          bottom: `${TOGGLE_FIXED_BOTTOM_PX}px`,
          top: "auto",
          right: "auto",
          border: "1px solid transparent",
          boxShadow: "none",
          background: "#121219"
        });
      } else {
        setStyles(btn, {
          border: "1px solid #39424c",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          background: "rgba(22,27,34,0.92)"
        });
        if (!loadPosition(TOGGLE_POSITION_KEY)) {
          setStyles(btn, { left: "auto", top: "auto", right: "16px", bottom: "16px" });
        }
      }
      saveToggleMode(mode);
    };
    setMode(currentMode);
    return { btn, setMode, getMode: () => currentMode };
  }

  // src/data/hardcoded-data.clean.js
  var rarity = {
    Common: "Common",
    Uncommon: "Uncommon",
    Rare: "Rare",
    Legendary: "Legendary",
    Mythic: "Mythical",
    Divine: "Divine",
    Celestial: "Celestial"
  };
  var harvestType = {
    Single: "Single",
    Multiple: "Multiple"
  };
  var tileRefsPlants = {
    Aloe: "sprite/plant/Aloe",
    Apple: "sprite/plant/Apple",
    BabyBeet: "sprite/plant/BabyBeet",
    BabyCarrot: "sprite/plant/BabyCarrot",
    Banana: "sprite/plant/Banana",
    Beet: "sprite/plant/Beet",
    Blueberry: "sprite/plant/Blueberry",
    BurrosTail: "sprite/plant/BurrosTail",
    BushyTree: "sprite/plant/BushyTree",
    Cabbage: "sprite/plant/Cabbage",
    CabbagePlant: "sprite/plant/CabbagePlant",
    Cacao: "sprite/plant/Cacao",
    CacaoTree: "sprite/plant/CacaoTree",
    Camellia: "sprite/plant/Camellia",
    Carrot: "sprite/plant/Carrot",
    Chrysanthemum: "sprite/plant/Chrysanthemum",
    Coconut: "sprite/plant/Coconut",
    Corn: "sprite/plant/Corn",
    Date: "sprite/plant/Date",
    DatePalm: "sprite/plant/DatePalm",
    Daffodil: "sprite/plant/Daffodil",
    DawnCelestialCrop: "sprite/plant/DawnCelestialCrop",
    Delphinium: "sprite/plant/Delphinium",
    DirtPatch: "sprite/plant/DirtPatch",
    DragonFruit: "sprite/plant/DragonFruit",
    DragonFruitTree: "sprite/plant/DragonFruitTree",
    Echeveria: "sprite/plant/Echeveria",
    FavaBean: "sprite/plant/FavaBean",
    FlowerBush: "sprite/plant/FlowerBush",
    Gentian: "sprite/plant/Gentian",
    Grape: "sprite/plant/Grape",
    Hedge: "sprite/plant/Hedge",
    Lemon: "sprite/plant/Lemon",
    Lily: "sprite/plant/Lily",
    Lychee: "sprite/plant/Lychee",
    MoonCelestialCrop: "sprite/plant/MoonCelestialCrop",
    Mushroom: "sprite/plant/Mushroom",
    PalmTree: "sprite/plant/PalmTree",
    PassionFruit: "sprite/plant/PassionFruit",
    Peach: "sprite/plant/Peach",
    Pear: "sprite/plant/Pear",
    Pepper: "sprite/plant/Pepper",
    PineTree: "sprite/plant/PineTree",
    Poinsettia: "sprite/plant/Poinsettia",
    Pumpkin: "sprite/plant/Pumpkin",
    RoseRed: "sprite/plant/RoseRed",
    Shrub: "sprite/plant/Shrub",
    SproutFlower: "sprite/plant/SproutFlower",
    SproutFruit: "sprite/plant/SproutFruit",
    SproutVine: "sprite/plant/SproutVine",
    Squash: "sprite/plant/Squash",
    Starweaver: "sprite/plant/Starweaver",
    StemFlower: "sprite/plant/StemFlower",
    Strawberry: "sprite/plant/Strawberry",
    Sunflower: "sprite/plant/Sunflower",
    Tomato: "sprite/plant/Tomato",
    Tree: "sprite/plant/Tree",
    Trellis: "sprite/plant/Trellis",
    Tulip: "sprite/plant/Tulip",
    VioletCort: "sprite/plant/VioletCort",
    Watermelon: "sprite/plant/Watermelon"
  };
  var tileRefsTallPlants = {
    Bamboo: "sprite/tall-plant/Bamboo",
    Cactus: "sprite/tall-plant/Cactus",
    DawnCelestialPlant: "sprite/tall-plant/DawnCelestialPlant",
    DawnCelestialPlantActive: "sprite/tall-plant/DawnCelestialPlantActive",
    DawnCelestialPlatform: "sprite/tall-plant/DawnCelestialPlatform",
    DawnCelestialPlatformTopmostLayer: "sprite/tall-plant/DawnCelestialPlatformTopmostLayer",
    MoonCelestialPlant: "sprite/tall-plant/MoonCelestialPlant",
    MoonCelestialPlantActive: "sprite/tall-plant/MoonCelestialPlantActive",
    MoonCelestialPlatform: "sprite/tall-plant/MoonCelestialPlatform",
    StarweaverPlant: "sprite/tall-plant/StarweaverPlant",
    StarweaverPlatform: "sprite/tall-plant/StarweaverPlatform"
  };
  var tileRefsSeeds = {
    Aloe: "sprite/seed/Aloe",
    Apple: "sprite/seed/Apple",
    Bamboo: "sprite/seed/Bamboo",
    Banana: "sprite/seed/Banana",
    Beet: "sprite/seed/Beet",
    Blueberry: "sprite/seed/Blueberry",
    BurrosTail: "sprite/seed/BurrosTail",
    Cabbage: "sprite/seed/Cabbage",
    Cacao: "sprite/seed/Cacao",
    Cactus: "sprite/seed/Cactus",
    Camellia: "sprite/seed/Camellia",
    Carrot: "sprite/seed/Carrot",
    Chrysanthemum: "sprite/seed/Chrysanthemum",
    Coconut: "sprite/seed/Coconut",
    Corn: "sprite/seed/Corn",
    Date: "sprite/seed/Date",
    Daffodil: "sprite/seed/Daffodil",
    DawnCelestial: "sprite/seed/DawnCelestial",
    Delphinium: "sprite/seed/Delphinium",
    DragonFruit: "sprite/seed/DragonFruit",
    Echeveria: "sprite/seed/Echeveria",
    FavaBean: "sprite/seed/FavaBean",
    Gentian: "sprite/seed/Gentian",
    Grape: "sprite/seed/Grape",
    Lemon: "sprite/seed/Lemon",
    Lily: "sprite/seed/Lily",
    Lychee: "sprite/seed/Lychee",
    MoonCelestial: "sprite/seed/MoonCelestial",
    Mushroom: "sprite/seed/Mushroom",
    PassionFruit: "sprite/seed/PassionFruit",
    Peach: "sprite/seed/Peach",
    Pear: "sprite/seed/Pear",
    Pepper: "sprite/seed/Pepper",
    Pinecone: "sprite/seed/Pinecone",
    Poinsettia: "sprite/seed/Poinsettia",
    Pumpkin: "sprite/seed/Pumpkin",
    Rose: "sprite/seed/Rose",
    Squash: "sprite/seed/Squash",
    Starweaver: "sprite/seed/Starweaver",
    Strawberry: "sprite/seed/Strawberry",
    Sunflower: "sprite/seed/Sunflower",
    Tomato: "sprite/seed/Tomato",
    Tulip: "sprite/seed/Tulip",
    VioletCort: "sprite/seed/VioletCort",
    Watermelon: "sprite/seed/Watermelon"
  };
  var tileRefsItems = {
    Coin: 1,
    InventoryBag: 7,
    MoneyBag: 11,
    JournalStamp: 22,
    Donut: 23,
    ToolsRestocked: 24,
    SeedsRestocked: 25,
    EggsRestocked: 26,
    DecorRestocked: 27,
    Leaderboard: 28,
    Stats: 29,
    ActivityLog: 30,
    ChatBubble: 39,
    ArrowKeys: 41,
    Touchpad: 42,
    AmberlitPotion: "sprite/item/AmberlitPotion",
    ChilledPotion: "sprite/item/ChilledPotion",
    CropCleanser: "sprite/item/CropCleanser",
    DawnlitPotion: "sprite/item/DawnlitPotion",
    FrozenPotion: "sprite/item/FrozenPotion",
    GoldPotion: "sprite/item/GoldPotion",
    PlanterPot: "sprite/item/PlanterPot",
    RainbowPotion: "sprite/item/RainbowPotion",
    Shovel: "sprite/item/Shovel",
    WateringCan: "sprite/item/WateringCan",
    WetPotion: "sprite/item/WetPotion"
  };
  var tileRefsPets = {
    Bee: "sprite/pet/Bee",
    Bunny: "sprite/pet/Bunny",
    Butterfly: "sprite/pet/Butterfly",
    Capybara: "sprite/pet/Capybara",
    Chicken: "sprite/pet/Chicken",
    CommonEgg: "sprite/pet/CommonEgg",
    Cow: "sprite/pet/Cow",
    Dragonfly: "sprite/pet/Dragonfly",
    FireHorse: "sprite/pet/FireHorse",
    FireHorseActive: "sprite/pet/FireHorseActive",
    Goat: "sprite/pet/Goat",
    Horse: "sprite/pet/Horse",
    HorseEgg: "sprite/pet/HorseEgg",
    LegendaryEgg: "sprite/pet/LegendaryEgg",
    MythicalEgg: "sprite/pet/MythicalEgg",
    Peacock: "sprite/pet/Peacock",
    Pig: "sprite/pet/Pig",
    Pony: "sprite/pet/Pony",
    RareEgg: "sprite/pet/RareEgg",
    Snail: "sprite/pet/Snail",
    SnowEgg: "sprite/pet/SnowEgg",
    SnowFox: "sprite/pet/SnowFox",
    Squirrel: "sprite/pet/Squirrel",
    Stoat: "sprite/pet/Stoat",
    Turkey: "sprite/pet/Turkey",
    Turtle: "sprite/pet/Turtle",
    UncommonEgg: "sprite/pet/UncommonEgg",
    WhiteCaribou: "sprite/pet/WhiteCaribou",
    WinterEgg: "sprite/pet/WinterEgg",
    Worm: "sprite/pet/Worm",
    DivineEgg: 16,
    CelestialEgg: 17
  };
  var tileRefsMutations = {
    Ambercharged: "sprite/mutation/Ambercharged",
    Amberlit: "sprite/mutation/Amberlit",
    Chilled: "sprite/mutation/Chilled",
    Dawncharged: "sprite/mutation/Dawncharged",
    Dawnlit: "sprite/mutation/Dawnlit",
    Frozen: "sprite/mutation/Frozen",
    Puddle: "sprite/mutation/Puddle",
    Thundercharged: "sprite/mutation/Thundercharged",
    Thunderstruck: "sprite/mutation/Thunderstruck",
    ThunderstruckGround: "sprite/mutation/ThunderstruckGround",
    Wet: "sprite/mutation/Wet"
  };
  var tileRefsDecor = {
    Birdhouse: "sprite/decor/Birdhouse",
    Cauldron: "sprite/decor/Cauldron",
    ColoredStringLights: "sprite/decor/ColoredStringLights",
    ColoredStringLightsSideways: "sprite/decor/ColoredStringLightsSideways",
    DecorShed: "sprite/decor/DecorShed",
    FanousLantern: "sprite/decor/FanousLantern",
    FanousLanternLit: "sprite/decor/FanousLanternLit",
    FanousLanternSideways: "sprite/decor/FanousLanternSideways",
    FanousLanternSidewaysLit: "sprite/decor/FanousLanternSidewaysLit",
    HayBale: "sprite/decor/HayBale",
    FeedingTrough: "sprite/decor/FeedingTrough",
    FeedingTroughCover: "sprite/decor/FeedingTroughCover",
    HayBaleSideways: "sprite/decor/HayBaleSideways",
    LargeGravestone: "sprite/decor/LargeGravestone",
    LargeGravestoneSideways: "sprite/decor/LargeGravestoneSideways",
    LargeRock: "sprite/decor/LargeRock",
    MarbleArch: "sprite/decor/MarbleArch",
    MarbleArchSideways: "sprite/decor/MarbleArchSideways",
    MarbleBench: "sprite/decor/MarbleBench",
    MarbleBenchBackwards: "sprite/decor/MarbleBenchBackwards",
    MarbleBenchSideways: "sprite/decor/MarbleBenchSideways",
    MarbleBlobling: "sprite/decor/MarbleBlobling",
    MarbleBridge: "sprite/decor/MarbleBridge",
    MarbleBridgeSideways: "sprite/decor/MarbleBridgeSideways",
    MarbleCaribou: "sprite/decor/MarbleCaribou",
    MarbleFountain: "sprite/decor/MarbleFountain",
    MarbleLampPost: "sprite/decor/MarbleLampPost",
    MediumGravestone: "sprite/decor/MediumGravestone",
    MediumGravestoneSideways: "sprite/decor/MediumGravestoneSideways",
    MediumRock: "sprite/decor/MediumRock",
    MiniFairyCottage: "sprite/decor/MiniFairyCottage",
    MiniFairyForge: "sprite/decor/MiniFairyForge",
    MiniFairyKeep: "sprite/decor/MiniFairyKeep",
    MiniWizardTower: "sprite/decor/MiniWizardTower",
    PaperLantern: "sprite/decor/PaperLantern",
    PaperLanternSideways: "sprite/decor/PaperLanternSideways",
    PetHutch: "sprite/decor/PetHutch",
    SeedSilo: "sprite/decor/SeedSilo",
    SmallGravestone: "sprite/decor/SmallGravestone",
    SmallGravestoneSideways: "sprite/decor/SmallGravestoneSideways",
    SmallRock: "sprite/decor/SmallRock",
    StoneArch: "sprite/decor/StoneArch",
    StoneArchSideways: "sprite/decor/StoneArchSideways",
    StoneBench: "sprite/decor/StoneBench",
    StoneBenchSideways: "sprite/decor/StoneBenchSideways",
    StoneBirdBath: "sprite/decor/StoneBirdBath",
    StoneBridge: "sprite/decor/StoneBridge",
    StoneBridgeSideways: "sprite/decor/StoneBridgeSideways",
    StoneCaribou: "sprite/decor/StoneCaribou",
    StoneGnome: "sprite/decor/StoneGnome",
    StoneLampPost: "sprite/decor/StoneLampPost",
    StrawScarecrow: "sprite/decor/StrawScarecrow",
    StringLights: "sprite/decor/StringLights",
    StringLightsSideways: "sprite/decor/StringLightsSideways",
    WoodArch: "sprite/decor/WoodArch",
    WoodArchSide: "sprite/decor/WoodArchSide",
    WoodBench: "sprite/decor/WoodBench",
    WoodBenchBackwards: "sprite/decor/WoodBenchBackwards",
    WoodBenchSideways: "sprite/decor/WoodBenchSideways",
    WoodBridge: "sprite/decor/WoodBridge",
    WoodBridgeSideways: "sprite/decor/WoodBridgeSideways",
    WoodCaribou: "sprite/decor/WoodCaribou",
    WoodLampPost: "sprite/decor/WoodLampPost",
    WoodOwl: "sprite/decor/WoodOwl",
    WoodPergola: "sprite/decor/WoodPergola",
    WoodWindmill: "sprite/decor/WoodWindmill"
  };
  var plantCatalog = {
    Carrot: {
      seed: {
        tileRef: tileRefsSeeds.Carrot,
        name: "Carrot Seed",
        coinPrice: 10,
        creditPrice: 7,
        rarity: rarity.Common
      },
      plant: {
        tileRef: tileRefsPlants.BabyCarrot,
        name: "Carrot Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.7
      },
      crop: {
        tileRef: tileRefsPlants.Carrot,
        name: "Carrot",
        baseSellPrice: 20,
        baseWeight: 0.1,
        baseTileScale: 0.6,
        maxScale: 3
      }
    },
    Cabbage: {
      seed: {
        tileRef: tileRefsSeeds.Cabbage,
        name: "Cabbage Seed",
        coinPrice: 30,
        creditPrice: 12,
        rarity: rarity.Common
      },
      plant: {
        tileRef: tileRefsPlants.CabbagePlant,
        name: "Cabbage Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [{
          x: 0,
          y: -0.05,
          rotation: 0
        }],
        secondsToMature: 45,
        baseTileScale: 1,
        rotateSlotOffsetsRandomly: false
      },
      crop: {
        tileRef: tileRefsPlants.Cabbage,
        name: "Cabbage",
        baseSellPrice: 42,
        baseWeight: 1,
        baseTileScale: 0.8,
        maxScale: 3
      }
    },
    Strawberry: {
      seed: {
        tileRef: tileRefsSeeds.Strawberry,
        name: "Strawberry Seed",
        coinPrice: 50,
        creditPrice: 21,
        rarity: rarity.Common
      },
      plant: {
        tileRef: tileRefsPlants.SproutFruit,
        name: "Strawberry Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.2, y: -0.1, rotation: 0 },
          { x: 0.175, y: -0.2, rotation: 0 },
          { x: -0.18, y: 0.22, rotation: 0 },
          { x: 0.2, y: 0.2, rotation: 0 },
          { x: 0.01, y: 0.01, rotation: 0 }
        ],
        secondsToMature: 70,
        baseTileScale: 1,
        rotateSlotOffsetsRandomly: true
      },
      crop: {
        tileRef: tileRefsPlants.Strawberry,
        name: "Strawberry",
        baseSellPrice: 14,
        baseWeight: 0.05,
        baseTileScale: 0.25,
        maxScale: 2
      }
    },
    Aloe: {
      seed: {
        tileRef: tileRefsSeeds.Aloe,
        name: "Aloe Seed",
        coinPrice: 135,
        creditPrice: 18,
        rarity: rarity.Common
      },
      plant: {
        tileRef: tileRefsPlants.AloePlant,
        name: "Aloe Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.9
      },
      crop: {
        tileRef: tileRefsPlants.Aloe,
        name: "Aloe",
        baseSellPrice: 310,
        baseWeight: 1.5,
        baseTileScale: 0.7,
        maxScale: 2.5
      }
    },
    Beet: {
      seed: {
        tileRef: tileRefsSeeds.Beet,
        name: "Beet Seed",
        coinPrice: 210,
        creditPrice: 25,
        rarity: rarity.Common
      },
      plant: {
        tileRef: tileRefsPlants.BabyBeet,
        name: "Beet Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.7
      },
      crop: {
        tileRef: tileRefsPlants.Beet,
        name: "Beet",
        baseSellPrice: 350,
        baseWeight: 0.3,
        baseTileScale: 0.2,
        maxScale: 3
      }
    },
    Rose: {
      seed: {
        tileRef: tileRefsSeeds.Rose,
        name: "Rose Seed",
        coinPrice: 229,
        creditPrice: 27,
        rarity: rarity.Uncommon
      },
      plant: {
        tileRef: tileRefsPlants.RoseRed,
        name: "Rose Plant",
        harvestType: harvestType.Single,
        baseTileScale: 1
      },
      crop: {
        tileRef: tileRefsPlants.RoseRed,
        name: "Rose",
        baseSellPrice: 300,
        baseWeight: 0.01,
        baseTileScale: 1,
        maxScale: 4
      }
    },
    FavaBean: {
      seed: {
        tileRef: tileRefsSeeds.FavaBean,
        name: "Fava Bean",
        coinPrice: 250,
        creditPrice: 30,
        rarity: rarity.Uncommon
      },
      plant: {
        tileRef: tileRefsPlants.SproutFlower,
        name: "Fava Bean Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.1, y: 0.15, rotation: 35 },
          { x: -0.23, y: 0.22, rotation: 35 },
          { x: 0.05, y: 0.3, rotation: 35 },
          { x: 0.18, y: 0.25, rotation: 35 },
          { x: 0.22, y: -0.02, rotation: 35 },
          { x: 0.1, y: -0.15, rotation: 35 },
          { x: -0.1, y: -0.17, rotation: 35 },
          { x: -0.25, y: -0.11, rotation: 35 }
        ],
        secondsToMature: 900,
        baseTileScale: 1.1,
        rotateSlotOffsetsRandomly: true
      },
      crop: {
        tileRef: tileRefsPlants.FavaBean,
        name: "Fava Bean Pod",
        baseSellPrice: 30,
        baseWeight: 0.03,
        baseTileScale: 0.3,
        maxScale: 3
      }
    },
    Delphinium: {
      seed: {
        tileRef: tileRefsSeeds.Delphinium,
        name: "Delphinium Seed",
        coinPrice: 300,
        creditPrice: 12,
        rarity: rarity.Uncommon
      },
      plant: {
        tileRef: tileRefsPlants.Delphinium,
        name: "Delphinium Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.8,
        tileTransformOrigin: "bottom",
        nudgeY: -0.43,
        nudgeYMultiplier: 0.05
      },
      crop: {
        tileRef: tileRefsPlants.Delphinium,
        name: "Delphinium",
        baseSellPrice: 530,
        baseWeight: 0.02,
        baseTileScale: 0.8,
        maxScale: 3
      }
    },
    Blueberry: {
      seed: {
        tileRef: tileRefsSeeds.Blueberry,
        name: "Blueberry Seed",
        coinPrice: 400,
        creditPrice: 49,
        rarity: rarity.Uncommon
      },
      plant: {
        tileRef: tileRefsPlants.SproutFruit,
        name: "Blueberry Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.2, y: -0.1, rotation: 0 },
          { x: 0.175, y: -0.2, rotation: 0 },
          { x: -0.18, y: 0.22, rotation: 0 },
          { x: 0.2, y: 0.2, rotation: 0 },
          { x: 0.01, y: 0.01, rotation: 0 }
        ],
        secondsToMature: 105,
        baseTileScale: 1,
        rotateSlotOffsetsRandomly: true
      },
      crop: {
        tileRef: tileRefsPlants.Blueberry,
        name: "Blueberry",
        baseSellPrice: 23,
        baseWeight: 0.01,
        baseTileScale: 0.25,
        maxScale: 2
      }
    },
    Apple: {
      seed: {
        tileRef: tileRefsSeeds.Apple,
        name: "Apple Seed",
        coinPrice: 500,
        creditPrice: 67,
        rarity: rarity.Uncommon,
        unavailableSurfaces: ["discord"]
      },
      plant: {
        tileRef: tileRefsTallPlants.Tree,
        name: "Apple Tree",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.35, y: -2.4, rotation: 0 },
          { x: -0.5, y: -2, rotation: 0 },
          { x: 0.1, y: -2.2, rotation: 0 },
          { x: -0.2, y: -1.65, rotation: 0 },
          { x: 0.55, y: -1.9, rotation: 0 },
          { x: 0.3, y: -1.7, rotation: 0 },
          { x: 0.4, y: 0.1, rotation: 0 }
        ],
        secondsToMature: 360 * 60,
        baseTileScale: 3,
        rotateSlotOffsetsRandomly: true,
        tileTransformOrigin: "bottom",
        nudgeY: -0.25
      },
      crop: {
        tileRef: tileRefsPlants.Apple,
        name: "Apple",
        baseSellPrice: 73,
        baseWeight: 0.18,
        baseTileScale: 0.5,
        maxScale: 2
      }
    },
    OrangeTulip: {
      seed: {
        tileRef: tileRefsSeeds.Tulip,
        name: "Tulip Seed",
        coinPrice: 600,
        creditPrice: 14,
        rarity: rarity.Uncommon
      },
      plant: {
        tileRef: tileRefsPlants.Tulip,
        name: "Tulip Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.5
      },
      crop: {
        tileRef: tileRefsPlants.Tulip,
        name: "Tulip",
        baseSellPrice: 767,
        baseWeight: 0.01,
        baseTileScale: 0.5,
        maxScale: 3
      }
    },
    Tomato: {
      seed: {
        tileRef: tileRefsSeeds.Tomato,
        name: "Tomato Seed",
        coinPrice: 800,
        creditPrice: 79,
        rarity: rarity.Uncommon
      },
      plant: {
        tileRef: tileRefsPlants.SproutVine,
        name: "Tomato Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.3, y: -0.3, rotation: 0 },
          { x: 0.3, y: 0.3, rotation: 0 }
        ],
        secondsToMature: 1100,
        baseTileScale: 1,
        rotateSlotOffsetsRandomly: false
      },
      crop: {
        tileRef: tileRefsPlants.Tomato,
        name: "Tomato",
        baseSellPrice: 27,
        baseWeight: 0.3,
        baseTileScale: 0.33,
        maxScale: 2
      }
    },
    Daffodil: {
      seed: {
        tileRef: tileRefsSeeds.Daffodil,
        name: "Daffodil Seed",
        coinPrice: 1e3,
        creditPrice: 19,
        rarity: rarity.Rare
      },
      plant: {
        tileRef: tileRefsPlants.Daffodil,
        name: "Daffodil Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.5
      },
      crop: {
        tileRef: tileRefsPlants.Daffodil,
        name: "Daffodil",
        baseSellPrice: 1090,
        baseWeight: 0.01,
        baseTileScale: 0.5,
        maxScale: 3
      }
    },
    Corn: {
      seed: {
        tileRef: tileRefsSeeds.Corn,
        name: "Corn Kernel",
        coinPrice: 1300,
        creditPrice: 135,
        rarity: rarity.Rare
      },
      plant: {
        tileRef: tileRefsPlants.SproutVegetable,
        name: "Corn Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [{ x: 0, y: -0.1, rotation: 0 }],
        secondsToMature: 130,
        baseTileScale: 1,
        rotateSlotOffsetsRandomly: false
      },
      crop: {
        tileRef: tileRefsPlants.Corn,
        name: "Corn",
        baseSellPrice: 36,
        baseWeight: 1.2,
        baseTileScale: 0.7,
        maxScale: 2
      }
    },
    Watermelon: {
      seed: {
        tileRef: tileRefsSeeds.Watermelon,
        name: "Watermelon Seed",
        coinPrice: 2500,
        creditPrice: 195,
        rarity: rarity.Rare
      },
      plant: {
        tileRef: tileRefsPlants.Watermelon,
        name: "Watermelon Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.8
      },
      crop: {
        tileRef: tileRefsPlants.Watermelon,
        name: "Watermelon",
        baseSellPrice: 2708,
        baseWeight: 4.5,
        baseTileScale: 0.8,
        maxScale: 3
      }
    },
    Pumpkin: {
      seed: {
        tileRef: tileRefsSeeds.Pumpkin,
        name: "Pumpkin Seed",
        coinPrice: 3e3,
        creditPrice: 210,
        rarity: rarity.Rare
      },
      plant: {
        tileRef: tileRefsPlants.Pumpkin,
        name: "Pumpkin Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.8
      },
      crop: {
        tileRef: tileRefsPlants.Pumpkin,
        name: "Pumpkin",
        baseSellPrice: 3700,
        baseWeight: 6,
        baseTileScale: 0.8,
        maxScale: 3
      }
    },
    Echeveria: {
      seed: {
        tileRef: tileRefsSeeds.Echeveria,
        name: "Echeveria Cutting",
        coinPrice: 4200,
        creditPrice: 113,
        rarity: rarity.Rare
      },
      plant: {
        tileRef: tileRefsPlants.Echeveria,
        name: "Echeveria Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.8
      },
      crop: {
        tileRef: tileRefsPlants.Echeveria,
        name: "Echeveria",
        baseSellPrice: 4600,
        baseWeight: 0.8,
        baseTileScale: 0.8,
        maxScale: 2.75
      }
    },
    Pear: {
      seed: {
        tileRef: tileRefsSeeds.Pear,
        name: "Pear Seed",
        coinPrice: 6e3,
        creditPrice: 122,
        rarity: rarity.Rare
      },
      plant: {
        tileRef: tileRefsPlants.Tree,
        name: "Pear Tree",
        harvestType: harvestType.Multiple,
        slotOffsets: [{
          x: -0.5,
          y: -1,
          rotation: 0
        }, {
          x: -0.35,
          y: -0.4,
          rotation: 0
        }, {
          x: 0.1,
          y: -0.45,
          rotation: 0
        }, {
          x: 0,
          y: -0.9,
          rotation: 0
        }, {
          x: 0.4,
          y: -0.7,
          rotation: 0
        }, {
          x: 0.5,
          y: -1.1,
          rotation: 0
        }, {
          x: -0.3,
          y: 1.2,
          rotation: 0
        }],
        secondsToMature: 360 * 60,
        baseTileScale: 3,
        rotateSlotOffsetsRandomly: true,
        tileTransformOrigin: "bottom",
        nudgeY: -0.25
      },
      crop: {
        tileRef: tileRefsPlants.Pear,
        name: "Pear",
        baseSellPrice: 250,
        baseWeight: 0.17,
        baseTileScale: 0.5,
        maxScale: 2
      }
    },
    Gentian: {
      seed: {
        tileRef: tileRefsSeeds.Gentian,
        name: "Gentian Seed",
        coinPrice: 9e3,
        creditPrice: 30,
        rarity: rarity.Rare
      },
      plant: {
        tileRef: tileRefsPlants.Gentian,
        name: "Gentian Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.5
      },
      crop: {
        tileRef: tileRefsPlants.Gentian,
        name: "Gentian",
        baseSellPrice: 1e4,
        baseWeight: 0.02,
        baseTileScale: 0.5,
        maxScale: 3
      }
    },
    Coconut: {
      seed: {
        tileRef: tileRefsSeeds.Coconut,
        name: "Coconut Seed",
        coinPrice: 1e4,
        creditPrice: 235,
        rarity: rarity.Legendary
      },
      plant: {
        tileRef: tileRefsTallPlants.PalmTree,
        name: "Coconut Tree",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.2, y: -2.6, rotation: 0 },
          { x: -0.3, y: -2.4, rotation: 0 },
          { x: 0.2, y: -2.5, rotation: 0 },
          { x: -0.25, y: -2.1, rotation: 0 },
          { x: 0, y: -2.3, rotation: 0 },
          { x: 0.3, y: -2.2, rotation: 0 },
          { x: 0.05, y: -2, rotation: 0 }
        ],
        secondsToMature: 720 * 60,
        baseTileScale: 3,
        rotateSlotOffsetsRandomly: true,
        tileTransformOrigin: "bottom",
        nudgeY: -0.35
      },
      crop: {
        tileRef: tileRefsPlants.Coconut,
        name: "Coconut",
        baseSellPrice: 302,
        baseWeight: 5,
        baseTileScale: 0.25,
        maxScale: 3
      }
    },
    PineTree: {
      seed: {
        tileRef: tileRefsSeeds.Pinecone,
        name: "Pinecone",
        coinPrice: 12e3,
        creditPrice: 30,
        rarity: rarity.Legendary
      },
      plant: {
        tileRef: tileRefsPlants.PineTree,
        name: "Pine Tree",
        harvestType: harvestType.Single,
        baseTileScale: 1.5
      },
      crop: {
        tileRef: tileRefsPlants.PineTree,
        name: "Pine Tree",
        baseSellPrice: 15e3,
        baseWeight: 1e3,
        baseTileScale: 1.5,
        maxScale: 3.5
      }
    },
    Banana: {
      seed: {
        tileRef: tileRefsSeeds.Banana,
        name: "Banana Seed",
        coinPrice: 15e3,
        creditPrice: 199,
        rarity: rarity.Legendary,
        getCanSpawnInGuild: (guildId) => {
          const last = guildId.slice(-1);
          const r = parseInt(last, 10);
          return !isNaN(r) && r % 2 === 0;
        },
        unavailableSurfaces: ["web"]
      },
      plant: {
        tileRef: tileRefsTallPlants.PalmTree,
        name: "Banana Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.3, y: -1.7, rotation: 10 },
          { x: -0.2, y: -1.7, rotation: -10 },
          { x: -0.1, y: -1.7, rotation: -30 },
          { x: 0, y: -1.7, rotation: -50 },
          { x: 0.1, y: -1.7, rotation: -70 }
        ],
        secondsToMature: 14400,
        baseTileScale: 2.5,
        rotateSlotOffsetsRandomly: false,
        tileTransformOrigin: "bottom",
        nudgeY: -0.4
      },
      crop: {
        tileRef: tileRefsPlants.Banana,
        name: "Banana",
        baseSellPrice: 1750,
        baseWeight: 0.12,
        baseTileScale: 0.5,
        maxScale: 1.7
      }
    },
    Lily: {
      seed: {
        tileRef: tileRefsSeeds.Lily,
        name: "Lily Seed",
        coinPrice: 2e4,
        creditPrice: 34,
        rarity: rarity.Legendary
      },
      plant: {
        tileRef: tileRefsPlants.Lily,
        name: "Lily Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.75,
        nudgeY: -0.1
      },
      crop: {
        tileRef: tileRefsPlants.Lily,
        name: "Lily",
        baseSellPrice: 20123,
        baseWeight: 0.02,
        baseTileScale: 0.5,
        maxScale: 2.75
      }
    },
    Camellia: {
      seed: {
        tileRef: tileRefsSeeds.Camellia,
        name: "Camellia Seed",
        coinPrice: 55e3,
        creditPrice: 289,
        rarity: rarity.Legendary
      },
      plant: {
        tileRef: tileRefsPlants.Hedge,
        name: "Camellia Hedge",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: 0, y: -0.9, rotation: 0 },
          { x: -0.28, y: -0.6, rotation: 0 },
          { x: 0.28, y: -0.6, rotation: 0 },
          { x: -0.35, y: -0.2, rotation: 0 },
          { x: 0.32, y: -0.2, rotation: 0 },
          { x: -0.3, y: 0.25, rotation: 0 },
          { x: 0.28, y: 0.25, rotation: 0 },
          { x: 0, y: 0, rotation: 0 }
        ],
        secondsToMature: 1440 * 60,
        baseTileScale: 2,
        rotateSlotOffsetsRandomly: true,
        tileTransformOrigin: "bottom",
        nudgeY: -0.4,
        nudgeYMultiplier: 0.5
      },
      crop: {
        tileRef: tileRefsPlants.Camellia,
        name: "Camellia",
        baseSellPrice: 4875,
        baseWeight: 0.3,
        baseTileScale: 0.4,
        maxScale: 2.5
      }
    },
    Squash: {
      seed: {
        tileRef: tileRefsSeeds.Squash,
        name: "Squash Seed",
        coinPrice: 55e3,
        creditPrice: 199,
        rarity: rarity.Legendary
      },
      plant: {
        tileRef: tileRefsPlants.SproutFlower,
        name: "Squash Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.08, y: 0.2, rotation: 35 },
          { x: 0.2, y: 0, rotation: 35 },
          { x: -0.2, y: -0.1, rotation: 35 }
        ],
        secondsToMature: 1500,
        baseTileScale: 1.2,
        rotateSlotOffsetsRandomly: true
      },
      crop: {
        tileRef: tileRefsPlants.Squash,
        name: "Squash",
        baseSellPrice: 3500,
        baseWeight: 0.3,
        baseTileScale: 0.4,
        maxScale: 2.5
      }
    },
    Peach: {
      seed: {
        tileRef: tileRefsSeeds.Peach,
        name: "Peach Seed",
        coinPrice: 85e3,
        creditPrice: 299,
        rarity: rarity.Legendary
      },
      plant: {
        tileRef: tileRefsPlants.Tree,
        name: "Peach Tree",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.66, y: -0.34, rotation: 0 },
          { x: -0.2, y: -0.1, rotation: 0 },
          { x: 0.35, y: -0.25, rotation: 0 },
          { x: 0.76, y: -0.56, rotation: 0 },
          { x: -0.08, y: -0.69, rotation: 0 },
          { x: 0.36, y: -1.03, rotation: 0 },
          { x: -0.54, y: -0.97, rotation: 0 }
        ],
        secondsToMature: 7200,
        rotateSlotOffsetsRandomly: true,
        baseTileScale: 3
      },
      crop: {
        tileRef: tileRefsPlants.Peach,
        name: "Peach",
        baseSellPrice: 9e3,
        baseWeight: 0.18,
        baseTileScale: 0.5,
        maxScale: 3
      }
    },
    BurrosTail: {
      seed: {
        tileRef: tileRefsSeeds.BurrosTail,
        name: "Burro's Tail Cutting",
        coinPrice: 93e3,
        creditPrice: 338,
        rarity: rarity.Legendary
      },
      plant: {
        tileRef: tileRefsPlants.Trellis,
        name: "Burro's Tail Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.13, y: -0.1, rotation: 0 },
          { x: 0.17, y: 0.13, rotation: 0 }
        ],
        secondsToMature: 1800,
        baseTileScale: 0.8,
        rotateSlotOffsetsRandomly: false
      },
      crop: {
        tileRef: tileRefsPlants.BurrosTail,
        name: "Burro's Tail",
        baseSellPrice: 6e3,
        baseWeight: 0.4,
        baseTileScale: 0.4,
        maxScale: 2.5
      }
    },
    Mushroom: {
      seed: {
        tileRef: tileRefsSeeds.Mushroom,
        name: "Mushroom Spore",
        coinPrice: 15e4,
        creditPrice: 249,
        rarity: rarity.Mythic
      },
      plant: {
        tileRef: tileRefsPlants.MushroomPlant,
        name: "Mushroom Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.8
      },
      crop: {
        tileRef: tileRefsPlants.Mushroom,
        name: "Mushroom",
        baseSellPrice: 16e4,
        baseWeight: 25,
        baseTileScale: 0.65,
        maxScale: 3.5
      }
    },
    Cactus: {
      seed: {
        tileRef: tileRefsSeeds.Cactus,
        name: "Cactus Seed",
        coinPrice: 25e4,
        creditPrice: 250,
        rarity: rarity.Mythic
      },
      plant: {
        tileRef: tileRefsTallPlants.Cactus,
        name: "Cactus Plant",
        harvestType: harvestType.Single,
        baseTileScale: 2.5,
        tileTransformOrigin: "bottom",
        nudgeY: -0.4,
        nudgeYMultiplier: 0.3
      },
      crop: {
        tileRef: tileRefsTallPlants.Cactus,
        name: "Cactus",
        baseSellPrice: 261e3,
        baseWeight: 1500,
        baseTileScale: 2.5,
        maxScale: 1.8
      }
    },
    Bamboo: {
      seed: {
        tileRef: tileRefsSeeds.Bamboo,
        name: "Bamboo Seed",
        coinPrice: 4e5,
        creditPrice: 300,
        rarity: rarity.Mythic
      },
      plant: {
        tileRef: tileRefsTallPlants.Bamboo,
        name: "Bamboo Plant",
        harvestType: harvestType.Single,
        baseTileScale: 2.5,
        tileTransformOrigin: "bottom",
        nudgeY: -0.45,
        nudgeYMultiplier: 0.3
      },
      crop: {
        tileRef: tileRefsTallPlants.Bamboo,
        name: "Bamboo Shoot",
        baseSellPrice: 5e5,
        baseWeight: 1,
        baseTileScale: 2.5,
        maxScale: 2
      }
    },
    Poinsettia: {
      seed: {
        tileRef: tileRefsSeeds.Poinsettia,
        name: "Poinsettia Seed",
        coinPrice: 5e5,
        creditPrice: 500,
        rarity: rarity.Mythic
      },
      plant: {
        tileRef: tileRefsTallPlants.Shrub,
        name: "Poinsettia Bush",
        harvestType: harvestType.Multiple,
        slotOffsets: [{
          x: 0.05,
          y: -0.4,
          rotation: 0
        }, {
          x: -0.3,
          y: -0.15,
          rotation: 0
        }, {
          x: 0.3,
          y: -0.1,
          rotation: 0
        }, {
          x: -0.02,
          y: 0.17,
          rotation: 0
        }],
        secondsToMature: 10800,
        baseTileScale: 1,
        rotateSlotOffsetsRandomly: true
      },
      crop: {
        tileRef: tileRefsTallPlants.Poinsettia,
        name: "Poinsettia",
        baseSellPrice: 3e4,
        baseWeight: 0.02,
        baseTileScale: 0.3,
        maxScale: 2
      }
    },
    VioletCort: {
      seed: {
        tileRef: tileRefsSeeds.VioletCort,
        name: "Violet Cort Spore",
        coinPrice: 52e4,
        creditPrice: 530,
        rarity: rarity.Mythic
      },
      plant: {
        tileRef: tileRefsPlants.VioletCort,
        name: "Violet Cort Plant",
        harvestType: harvestType.Single,
        baseTileScale: 0.55
      },
      crop: {
        tileRef: tileRefsPlants.VioletCort,
        name: "Violet Cort",
        baseSellPrice: 6e5,
        baseWeight: 2,
        baseTileScale: 0.65,
        maxScale: 3.5
      }
    },
    Chrysanthemum: {
      seed: {
        tileRef: tileRefsSeeds.Chrysanthemum,
        name: "Chrysanthemum Seed",
        coinPrice: 67e4,
        creditPrice: 567,
        rarity: rarity.Mythic
      },
      plant: {
        tileRef: tileRefsPlants.FlowerBush,
        name: "Chrysanthemum Bush",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: 0, y: 0, rotation: 0 },
          { x: -0.28, y: 0.22, rotation: 0 },
          { x: 0.28, y: 0.22, rotation: 0 },
          { x: 0, y: 0.33, rotation: 0 },
          { x: -0.25, y: -0.2, rotation: 0 },
          { x: 0.25, y: -0.2, rotation: 0 },
          { x: 0, y: -0.28, rotation: 0 }
        ],
        secondsToMature: 1440 * 60,
        baseTileScale: 1,
        rotateSlotOffsetsRandomly: false,
        tileTransformOrigin: "bottom"
      },
      crop: {
        tileRef: tileRefsPlants.Chrysanthemum,
        name: "Chrysanthemum",
        baseSellPrice: 18e3,
        baseWeight: 0.01,
        baseTileScale: 0.3,
        maxScale: 2.75
      }
    },
    Date: {
      seed: {
        tileRef: tileRefsSeeds.Date,
        name: "Date Seed",
        coinPrice: 75e4,
        creditPrice: 580,
        rarity: rarity.Mythic
      },
      plant: {
        tileRef: tileRefsPlants.DatePalm,
        name: "Date Palm",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.2, y: -0.55, rotation: -10 },
          { x: -0.19, y: -0.7, rotation: 10 },
          { x: 0.1, y: -0.52, rotation: -56 },
          { x: 0.15, y: -0.63, rotation: -76 },
          { x: 0.26, y: -0.64, rotation: -96 },
          { x: -0.11, y: -0.42, rotation: -21 },
          { x: -0.09, y: -0.62, rotation: -16 },
          { x: 0.24, y: -0.47, rotation: -56 },
          { x: -0.33, y: -0.54, rotation: -16 },
          { x: -0.23, y: -0.38, rotation: -16 },
          { x: 0.19, y: -0.37, rotation: -56 }
        ],
        secondsToMature: 1080 * 60,
        baseTileScale: 2.8,
        rotateSlotOffsetsRandomly: false,
        tileTransformOrigin: "bottom"
      },
      crop: {
        tileRef: tileRefsPlants.Date,
        name: "Date",
        baseSellPrice: 15e3,
        baseWeight: 0.02,
        baseTileScale: 0.25,
        maxScale: 2
      }
    },
    Grape: {
      seed: {
        tileRef: tileRefsSeeds.Grape,
        name: "Grape Seed",
        coinPrice: 85e4,
        creditPrice: 599,
        rarity: rarity.Mythic,
        getCanSpawnInGuild: (guildId) => guildId.endsWith("1"),
        unavailableSurfaces: ["web"]
      },
      plant: {
        tileRef: tileRefsPlants.SproutVine,
        name: "Grape Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [{ x: 0, y: 0, rotation: 0 }],
        secondsToMature: 1440 * 60,
        baseTileScale: 1,
        rotateSlotOffsetsRandomly: true
      },
      crop: {
        tileRef: tileRefsPlants.Grape,
        name: "Grape",
        baseSellPrice: 12500,
        baseWeight: 3,
        baseTileScale: 0.5,
        maxScale: 2
      }
    },
    Pepper: {
      seed: {
        tileRef: tileRefsSeeds.Pepper,
        name: "Pepper Seed",
        coinPrice: 1e6,
        creditPrice: 629,
        rarity: rarity.Divine
      },
      plant: {
        tileRef: tileRefsPlants.SproutVine,
        name: "Pepper Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.02, y: 0.219, rotation: 0 },
          { x: 0.172, y: 0.172, rotation: 0 },
          { x: -0.172, y: 0.137, rotation: 0 },
          { x: 0.168, y: -0.035, rotation: 0 },
          { x: -0.082, y: -0.047, rotation: 0 },
          { x: -0.207, y: -0.074, rotation: 0 },
          { x: 0.18, y: -0.176, rotation: 0 },
          { x: -0.273, y: -0.195, rotation: 0 },
          { x: -0.074, y: -0.25, rotation: 0 }
        ],
        secondsToMature: 560,
        baseTileScale: 1,
        rotateSlotOffsetsRandomly: true
      },
      crop: {
        tileRef: tileRefsPlants.Pepper,
        name: "Pepper",
        baseSellPrice: 7220,
        baseWeight: 0.5,
        baseTileScale: 0.3,
        maxScale: 2
      }
    },
    Lemon: {
      seed: {
        tileRef: tileRefsSeeds.Lemon,
        name: "Lemon Seed",
        coinPrice: 2e6,
        creditPrice: 500,
        rarity: rarity.Divine,
        getCanSpawnInGuild: (guildId) => guildId.endsWith("2"),
        unavailableSurfaces: ["web"]
      },
      plant: {
        tileRef: tileRefsTallPlants.Tree,
        name: "Lemon Tree",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.5, y: -1.5, rotation: 0 },
          { x: 0.4, y: -1.6, rotation: 0 },
          { x: -0.3, y: -1.18, rotation: 0 },
          { x: 0.2, y: -1.2, rotation: 0 },
          { x: 0.01, y: -1.5, rotation: 0 },
          { x: -0.05, y: -1.8, rotation: 0 }
        ],
        secondsToMature: 720 * 60,
        baseTileScale: 2.3,
        rotateSlotOffsetsRandomly: true,
        tileTransformOrigin: "bottom",
        nudgeY: -0.25
      },
      crop: {
        tileRef: tileRefsPlants.Lemon,
        name: "Lemon",
        baseSellPrice: 1e4,
        baseWeight: 0.5,
        baseTileScale: 0.25,
        maxScale: 3
      }
    },
    PassionFruit: {
      seed: {
        tileRef: tileRefsSeeds.PassionFruit,
        name: "Passion Fruit Seed",
        coinPrice: 275e4,
        creditPrice: 679,
        rarity: rarity.Divine
      },
      plant: {
        tileRef: tileRefsPlants.SproutVine,
        name: "Passion Fruit Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.3, y: -0.3, rotation: 0 },
          { x: 0.3, y: 0.3, rotation: 0 }
        ],
        secondsToMature: 1440 * 60,
        baseTileScale: 1.1,
        rotateSlotOffsetsRandomly: false
      },
      crop: {
        tileRef: tileRefsPlants.PassionFruit,
        name: "Passion Fruit",
        baseSellPrice: 24500,
        baseWeight: 9.5,
        baseTileScale: 0.35,
        maxScale: 2
      }
    },
    DragonFruit: {
      seed: {
        tileRef: tileRefsSeeds.DragonFruit,
        name: "Dragon Fruit Seed",
        coinPrice: 5e6,
        creditPrice: 715,
        rarity: rarity.Divine
      },
      plant: {
        tileRef: tileRefsPlants.PalmTree,
        name: "Dragon Fruit Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.3, y: -0.4, rotation: 0 },
          { x: -0.4, y: -0.05, rotation: 0 },
          { x: 0.36, y: -0.3, rotation: 0 },
          { x: -0.25, y: 0.3, rotation: 0 },
          { x: 0, y: -0.1, rotation: 0 },
          { x: 0.4, y: 0.1, rotation: 0 },
          { x: 0.1, y: 0.2, rotation: 0 }
        ],
        secondsToMature: 600,
        baseTileScale: 1.6,
        rotateSlotOffsetsRandomly: true
      },
      crop: {
        tileRef: tileRefsPlants.DragonFruit,
        name: "Dragon Fruit",
        baseSellPrice: 24500,
        baseWeight: 8.4,
        baseTileScale: 0.4,
        maxScale: 2
      }
    },
    Cacao: {
      seed: {
        tileRef: tileRefsSeeds.Cacao,
        name: "Cacao Bean",
        coinPrice: 1e7,
        creditPrice: 750,
        rarity: rarity.Divine
      },
      plant: {
        tileRef: tileRefsTallPlants.CacaoTree,
        name: "Cacao Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: 0.28, y: -1.17, rotation: 20 },
          { x: -0.3, y: -1.07, rotation: 20 },
          { x: -0.05, y: -1.42, rotation: 20 },
          { x: 0.45, y: -1.67, rotation: 20 },
          { x: -0.5, y: -1.57, rotation: 20 },
          { x: -0.05, y: -1.87, rotation: 20 }
        ],
        secondsToMature: 1440 * 60,
        baseTileScale: 2.8,
        rotateSlotOffsetsRandomly: true,
        tileTransformOrigin: "bottom",
        nudgeY: -0.32
      },
      crop: {
        tileRef: tileRefsPlants.Cacao,
        name: "Cacao Fruit",
        baseSellPrice: 7e4,
        baseWeight: 0.5,
        baseTileScale: 0.4,
        maxScale: 2.5
      }
    },
    Lychee: {
      seed: {
        tileRef: tileRefsSeeds.Lychee,
        name: "Lychee Pit",
        coinPrice: 25e6,
        creditPrice: 819,
        rarity: rarity.Divine,
        getCanSpawnInGuild: (guildId) => guildId.endsWith("2"),
        unavailableSurfaces: ["web"]
      },
      plant: {
        tileRef: tileRefsPlants.BushyTree,
        name: "Lychee Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: -0.4, y: -0.1, rotation: 0 },
          { x: 0.3, y: -0.2, rotation: 0 },
          { x: -0.3, y: 0.22, rotation: 0 },
          { x: 0.2, y: 0.2, rotation: 0 },
          { x: 0.01, y: -0.1, rotation: 0 },
          { x: -0.2, y: -0.3, rotation: 0 }
        ],
        secondsToMature: 1440 * 60,
        baseTileScale: 1.2,
        rotateSlotOffsetsRandomly: true
      },
      crop: {
        tileRef: tileRefsPlants.Lychee,
        name: "Lychee Fruit",
        baseSellPrice: 5e4,
        baseWeight: 9,
        baseTileScale: 0.2,
        maxScale: 2
      }
    },
    Sunflower: {
      seed: {
        tileRef: tileRefsSeeds.Sunflower,
        name: "Sunflower Seed",
        coinPrice: 1e8,
        creditPrice: 900,
        rarity: rarity.Divine
      },
      plant: {
        tileRef: tileRefsPlants.StemFlower,
        name: "Sunflower Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [{ x: 0.01, y: -0.6, rotation: 0 }],
        secondsToMature: 1440 * 60,
        rotateSlotOffsetsRandomly: false,
        tileTransformOrigin: "bottom",
        baseTileScale: 0.8,
        nudgeY: -0.35
      },
      crop: {
        tileRef: tileRefsPlants.Sunflower,
        name: "Sunflower",
        baseSellPrice: 75e4,
        baseWeight: 10,
        baseTileScale: 0.5,
        maxScale: 2.5
      }
    },
    Starweaver: {
      seed: {
        tileRef: tileRefsSeeds.Starweaver,
        name: "Starweaver Pod",
        coinPrice: 1e9,
        creditPrice: 1e3,
        rarity: rarity.Celestial
      },
      plant: {
        tileRef: tileRefsTallPlants.StarweaverPlant,
        name: "Starweaver Plant",
        harvestType: harvestType.Multiple,
        slotOffsets: [{ x: 0, y: -0.918, rotation: 0 }],
        secondsToMature: 1440 * 60,
        baseTileScale: 1.5,
        rotateSlotOffsetsRandomly: false,
        tileTransformOrigin: "bottom",
        nudgeY: -0.27,
        immatureTileRef: tileRefsTallPlants.StarweaverPlatform,
        isFixedScale: true,
        growingAnimationTiles: { frames: 10, row: 8, fps: 20, nudgeY: -0.2 }
      },
      crop: {
        tileRef: tileRefsPlants.Starweaver,
        name: "Starweaver Fruit",
        baseSellPrice: 1e7,
        baseWeight: 10,
        baseTileScale: 0.6,
        maxScale: 2
      }
    },
    DawnCelestial: {
      seed: {
        tileRef: tileRefsSeeds.DawnCelestial,
        name: "Dawnbinder Pod",
        coinPrice: 1e10,
        creditPrice: 1129,
        rarity: rarity.Celestial
      },
      plant: {
        tileRef: tileRefsTallPlants.DawnCelestialPlant,
        name: "Dawnbinder",
        harvestType: harvestType.Multiple,
        secondsToMature: 1440 * 60,
        slotOffsets: [{ x: -0.015, y: -0.95, rotation: 0 }],
        baseTileScale: 2.3,
        rotateSlotOffsetsRandomly: false,
        tileTransformOrigin: "bottom",
        nudgeY: -0.2,
        abilities: ["DawnKisser"],
        activeState: {
          tileRef: tileRefsTallPlants.DawnCelestialPlantActive,
          activeAnimationTiles: { frames: 10, row: 6, fps: 20, nudgeY: -0.1 }
        },
        topmostLayerTileRef: tileRefsTallPlants.DawnCelestialPlatformTopmostLayer,
        immatureTileRef: tileRefsTallPlants.DawnCelestialPlatform,
        isFixedScale: true,
        growingAnimationTiles: { frames: 10, row: 8, fps: 20, nudgeY: -0.2 }
      },
      crop: {
        tileRef: tileRefsPlants.DawnCelestialCrop,
        name: "Dawnbinder Bulb",
        baseSellPrice: 11e6,
        baseWeight: 6,
        baseTileScale: 0.4,
        maxScale: 2.5,
        transformOrigin: "top"
      }
    },
    MoonCelestial: {
      seed: {
        tileRef: tileRefsSeeds.MoonCelestial,
        name: "Moonbinder Pod",
        coinPrice: 5e10,
        creditPrice: 1249,
        rarity: rarity.Celestial
      },
      plant: {
        tileRef: tileRefsTallPlants.MoonCelestialPlant,
        name: "Moonbinder",
        harvestType: harvestType.Multiple,
        slotOffsets: [
          { x: 0.01, y: -1.81, rotation: 0 },
          { x: -0.26, y: -0.82, rotation: -20 },
          { x: 0.23, y: -1, rotation: 20 }
        ],
        secondsToMature: 1440 * 60,
        baseTileScale: 2.5,
        rotateSlotOffsetsRandomly: false,
        tileTransformOrigin: "bottom",
        nudgeY: -0.2,
        abilities: ["MoonKisser"],
        activeState: {
          tileRef: tileRefsTallPlants.MoonCelestialPlantActive,
          activeAnimationTiles: { frames: 10, row: 6, fps: 20, nudgeY: -0.1 }
        },
        immatureTileRef: tileRefsTallPlants.MoonCelestialPlatform,
        isFixedScale: true,
        growingAnimationTiles: { frames: 10, row: 8, fps: 20, nudgeY: -0.2 }
      },
      crop: {
        tileRef: tileRefsPlants.MoonCelestialCrop,
        name: "Moonbinder Bulb",
        baseSellPrice: 11e6,
        baseWeight: 2,
        baseTileScale: 0.4,
        maxScale: 2,
        transformOrigin: "bottom"
      }
    }
  };
  var mutationCatalog = {
    Gold: { name: "Gold", baseChance: 0.01, coinMultiplier: 25 },
    Rainbow: { name: "Rainbow", baseChance: 1e-3, coinMultiplier: 50 },
    Wet: { name: "Wet", baseChance: 0, coinMultiplier: 2, tileRef: tileRefsMutations.Wet },
    Chilled: { name: "Chilled", baseChance: 0, coinMultiplier: 2, tileRef: tileRefsMutations.Chilled },
    Frozen: { name: "Frozen", baseChance: 0, coinMultiplier: 6, tileRef: tileRefsMutations.Frozen },
    Thunderstruck: { name: "Thunderstruck", baseChance: 0, coinMultiplier: 5, tileRef: tileRefsMutations.Thunderstruck },
    Thundercharged: { name: "Thundercharged", baseChance: 0, coinMultiplier: 7, tileRef: tileRefsMutations.Thundercharged },
    Dawnlit: { name: "Dawnlit", baseChance: 0, coinMultiplier: 4, tileRef: tileRefsMutations.Dawnlit },
    Amberlit: { name: "Amberlit", baseChance: 0, coinMultiplier: 6, tileRef: tileRefsMutations.Amberlit },
    Dawncharged: { name: "Dawnbound", baseChance: 0, coinMultiplier: 7, tileRef: tileRefsMutations.Dawncharged },
    Ambercharged: { name: "Amberbound", baseChance: 0, coinMultiplier: 10, tileRef: tileRefsMutations.Ambercharged }
  };
  var eggCatalog = {
    CommonEgg: { tileRef: tileRefsPets.CommonEgg, name: "Common Egg", coinPrice: 1e5, creditPrice: 19, rarity: rarity.Common, initialTileScale: 0.3, baseTileScale: 0.8, secondsToHatch: 600, faunaSpawnWeights: { Worm: 60, Snail: 35, Bee: 5 } },
    UncommonEgg: { tileRef: tileRefsPets.UncommonEgg, name: "Uncommon Egg", coinPrice: 1e6, creditPrice: 48, rarity: rarity.Uncommon, initialTileScale: 0.3, baseTileScale: 0.8, secondsToHatch: 3600, faunaSpawnWeights: { Chicken: 65, Bunny: 25, Dragonfly: 10 } },
    RareEgg: { tileRef: tileRefsPets.RareEgg, name: "Rare Egg", coinPrice: 1e7, creditPrice: 99, rarity: rarity.Rare, initialTileScale: 0.3, baseTileScale: 0.8, secondsToHatch: 21600, faunaSpawnWeights: { Pig: 80, Cow: 15, Turkey: 5 } },
    LegendaryEgg: { tileRef: tileRefsPets.LegendaryEgg, name: "Legendary Egg", coinPrice: 1e8, creditPrice: 249, rarity: rarity.Legendary, initialTileScale: 0.3, baseTileScale: 0.8, secondsToHatch: 43200, faunaSpawnWeights: { Squirrel: 60, Turtle: 30, Goat: 10 } },
    MythicalEgg: { tileRef: tileRefsPets.MythicalEgg, name: "Mythical Egg", coinPrice: 1e9, creditPrice: 599, rarity: rarity.Mythic, initialTileScale: 0.3, baseTileScale: 0.8, secondsToHatch: 86400, faunaSpawnWeights: { Butterfly: 75, Capybara: 5, Peacock: 20 } },
    WinterEgg: {
      tileRef: tileRefsPets.WinterEgg,
      name: "Winter Egg",
      coinPrice: 8e8,
      creditPrice: 199,
      rarity: rarity.Legendary,
      initialTileScale: 0.3,
      baseTileScale: 0.8,
      secondsToHatch: 43200,
      faunaSpawnWeights: { SnowFox: 75, Stoat: 20, WhiteCaribou: 5 },
      expiryDate: /* @__PURE__ */ new Date("2026-01-12T01:00:00.000Z")
    },
    SnowEgg: {
      tileRef: tileRefsPets.SnowEgg,
      name: "Snow Egg",
      coinPrice: 2e8,
      creditPrice: 269,
      rarity: rarity.Legendary,
      secondsToHatch: 43200,
      faunaSpawnWeights: {
        SnowFox: 75,
        Stoat: 20,
        WhiteCaribou: 5
      },
      requiredWeather: "Frost"
    },
    HorseEgg: {
      tileRef: tileRefsPets.HorseEgg,
      name: "Horse Egg",
      coinPrice: 2e8,
      creditPrice: 379,
      rarity: rarity.Legendary,
      initialTileScale: 0.3,
      baseTileScale: 0.8,
      secondsToHatch: 43200,
      faunaSpawnWeights: {
        Pony: 60,
        Horse: 35,
        FireHorse: 5
      }
    }
  };
  var petCatalog = {
    Worm: {
      tileRef: tileRefsPets.Worm,
      name: "Worm",
      description: "",
      coinsToFullyReplenishHunger: 500,
      innateAbilityWeights: { SeedFinderI: 50, ProduceEater: 50 },
      baseTileScale: 0.6,
      maxScale: 2,
      maturitySellPrice: 5e3,
      matureWeight: 0.1,
      moveProbability: 0.1,
      hoursToMature: 12,
      rarity: rarity.Common,
      tileTransformOrigin: "bottom",
      nudgeY: -0.25,
      diet: ["Carrot", "Strawberry", "Aloe", "Tomato", "Apple"]
    },
    Snail: {
      tileRef: tileRefsPets.Snail,
      name: "Snail",
      description: "",
      coinsToFullyReplenishHunger: 1e3,
      innateAbilityWeights: { CoinFinderI: 100 },
      baseTileScale: 0.6,
      maxScale: 2,
      maturitySellPrice: 1e4,
      matureWeight: 0.15,
      moveProbability: 0.01,
      hoursToMature: 12,
      rarity: rarity.Common,
      tileTransformOrigin: "bottom",
      nudgeY: -0.25,
      diet: ["Blueberry", "Tomato", "Corn", "Daffodil", "Chrysanthemum"]
    },
    Bee: {
      tileRef: tileRefsPets.Bee,
      name: "Bee",
      coinsToFullyReplenishHunger: 1500,
      innateAbilityWeights: { ProduceScaleBoost: 50, ProduceMutationBoost: 50 },
      baseTileScale: 0.6,
      maxScale: 2.5,
      maturitySellPrice: 3e4,
      matureWeight: 0.2,
      moveProbability: 0.5,
      hoursToMature: 12,
      rarity: rarity.Common,
      diet: ["Strawberry", "Blueberry", "Daffodil", "Lily", "Chrysanthemum"]
    },
    Chicken: {
      tileRef: tileRefsPets.Chicken,
      name: "Chicken",
      coinsToFullyReplenishHunger: 3e3,
      innateAbilityWeights: { EggGrowthBoost: 80, PetRefund: 20 },
      baseTileScale: 0.8,
      maxScale: 2,
      maturitySellPrice: 5e4,
      matureWeight: 3,
      moveProbability: 0.2,
      hoursToMature: 24,
      rarity: rarity.Uncommon,
      tileTransformOrigin: "bottom",
      nudgeY: -0.2,
      diet: ["Aloe", "Corn", "Watermelon", "Pumpkin"]
    },
    Bunny: {
      tileRef: tileRefsPets.Bunny,
      name: "Bunny",
      coinsToFullyReplenishHunger: 750,
      innateAbilityWeights: { CoinFinderII: 60, SellBoostI: 40 },
      baseTileScale: 0.7,
      maxScale: 2,
      maturitySellPrice: 75e3,
      matureWeight: 2,
      moveProbability: 0.3,
      hoursToMature: 24,
      rarity: rarity.Uncommon,
      tileTransformOrigin: "bottom",
      nudgeY: -0.2,
      diet: ["Carrot", "Strawberry", "Blueberry", "OrangeTulip", "Apple"]
    },
    Dragonfly: {
      tileRef: tileRefsPets.Dragonfly,
      name: "Dragonfly",
      coinsToFullyReplenishHunger: 250,
      innateAbilityWeights: { HungerRestore: 70, PetMutationBoost: 30 },
      baseTileScale: 0.6,
      maxScale: 2.5,
      maturitySellPrice: 15e4,
      matureWeight: 0.2,
      moveProbability: 0.7,
      hoursToMature: 24,
      rarity: rarity.Uncommon,
      tileTransformOrigin: "center",
      diet: ["Apple", "OrangeTulip", "Echeveria"]
    },
    Pig: {
      tileRef: tileRefsPets.Pig,
      name: "Pig",
      coinsToFullyReplenishHunger: 5e4,
      innateAbilityWeights: { SellBoostII: 30, PetAgeBoost: 30, PetHatchSizeBoost: 30 },
      baseTileScale: 1,
      maxScale: 2.5,
      maturitySellPrice: 5e5,
      matureWeight: 200,
      moveProbability: 0.2,
      hoursToMature: 72,
      rarity: rarity.Rare,
      tileTransformOrigin: "bottom",
      nudgeY: -0.15,
      diet: ["Watermelon", "Pumpkin", "Mushroom", "Bamboo"]
    },
    Cow: {
      tileRef: tileRefsPets.Cow,
      name: "Cow",
      coinsToFullyReplenishHunger: 25e3,
      innateAbilityWeights: { SeedFinderII: 30, HungerBoost: 30, PlantGrowthBoost: 30 },
      baseTileScale: 1.1,
      maxScale: 2.5,
      maturitySellPrice: 1e6,
      matureWeight: 600,
      moveProbability: 0.1,
      hoursToMature: 72,
      rarity: rarity.Rare,
      tileTransformOrigin: "bottom",
      nudgeY: -0.15,
      diet: ["Coconut", "Banana", "BurrosTail", "Mushroom"]
    },
    Turkey: {
      tileRef: tileRefsPets.Turkey,
      name: "Turkey",
      coinsToFullyReplenishHunger: 500,
      innateAbilityWeights: { RainDance: 60, EggGrowthBoostII_NEW: 35, DoubleHatch: 5 },
      baseTileScale: 1,
      maxScale: 2.5,
      maturitySellPrice: 3e6,
      matureWeight: 10,
      moveProbability: 0.25,
      hoursToMature: 72,
      rarity: rarity.Rare,
      tileTransformOrigin: "bottom",
      nudgeY: -0.15,
      diet: ["FavaBean", "Corn", "Squash"]
    },
    Squirrel: {
      tileRef: tileRefsPets.Squirrel,
      name: "Squirrel",
      coinsToFullyReplenishHunger: 15e3,
      innateAbilityWeights: { CoinFinderIII: 70, SellBoostIII: 20, PetMutationBoostII: 10 },
      baseTileScale: 0.6,
      maxScale: 2,
      maturitySellPrice: 5e6,
      matureWeight: 0.5,
      moveProbability: 0.4,
      hoursToMature: 100,
      rarity: rarity.Legendary,
      tileTransformOrigin: "bottom",
      nudgeY: -0.1,
      diet: ["Pumpkin", "Banana", "Grape"]
    },
    Turtle: {
      tileRef: tileRefsPets.Turtle,
      name: "Turtle",
      coinsToFullyReplenishHunger: 1e5,
      innateAbilityWeights: { HungerRestoreII: 25, HungerBoostII: 25, PlantGrowthBoostII: 25, EggGrowthBoostII: 25 },
      baseTileScale: 1,
      maxScale: 2.5,
      maturitySellPrice: 1e7,
      matureWeight: 150,
      moveProbability: 0.05,
      hoursToMature: 100,
      rarity: rarity.Legendary,
      tileTransformOrigin: "bottom",
      nudgeY: -0.15,
      diet: ["Watermelon", "BurrosTail", "Bamboo", "Pepper"]
    },
    Goat: {
      tileRef: tileRefsPets.Goat,
      name: "Goat",
      coinsToFullyReplenishHunger: 2e4,
      innateAbilityWeights: { PetHatchSizeBoostII: 10, PetAgeBoostII: 40, PetXpBoost: 40 },
      baseTileScale: 1,
      maxScale: 2,
      maturitySellPrice: 2e7,
      matureWeight: 100,
      moveProbability: 0.2,
      hoursToMature: 100,
      rarity: rarity.Legendary,
      tileTransformOrigin: "bottom",
      nudgeY: -0.1,
      diet: ["Pumpkin", "Coconut", "Pepper", "Camellia", "PassionFruit"]
    },
    SnowFox: {
      tileRef: tileRefsPets.SnowFox,
      name: "Snow Fox",
      coinsToFullyReplenishHunger: 14e3,
      innateAbilityWeights: {
        SnowGranter: 30,
        SnowyCoinFinder: 30,
        SnowyPetXpBoost: 30
      },
      maxScale: 2,
      maturitySellPrice: 7e6,
      matureWeight: 7.5,
      moveProbability: 0.35,
      moveTweenDurationMs: 400,
      hoursToMature: 100,
      rarity: rarity.Legendary,
      diet: ["Echeveria", "Squash", "Grape"]
    },
    Stoat: {
      tileRef: tileRefsPets.Stoat,
      name: "Stoat",
      coinsToFullyReplenishHunger: 1e4,
      innateAbilityWeights: {
        SnowGranter: 40,
        SnowyHungerBoost: 40,
        SnowyCropMutationBoost: 20
      },
      maxScale: 2,
      maturitySellPrice: 1e7,
      matureWeight: 0.4,
      moveProbability: 0.3,
      moveTweenDurationMs: 600,
      hoursToMature: 100,
      rarity: rarity.Legendary,
      diet: ["Banana", "Pepper", "Cactus"]
    },
    WhiteCaribou: {
      tileRef: tileRefsPets.WhiteCaribou,
      name: "Caribou",
      coinsToFullyReplenishHunger: 3e4,
      innateAbilityWeights: {
        FrostGranter: 50,
        SnowyPlantGrowthBoost: 40,
        SnowyCropSizeBoost: 10
      },
      maxScale: 2.5,
      maturitySellPrice: 15e6,
      matureWeight: 300,
      moveProbability: 0.2,
      moveTweenDurationMs: 1e3,
      hoursToMature: 100,
      rarity: rarity.Legendary,
      diet: ["Camellia", "BurrosTail", "Mushroom"]
    },
    Pony: {
      tileRef: tileRefsPets.Pony,
      name: "Pony",
      coinsToFullyReplenishHunger: 4e3,
      innateAbilityWeights: {
        SellBoostIII: 25,
        CoinFinderIII: 25,
        HungerRestoreII: 25,
        SeedFinderII: 25
      },
      maxScale: 2,
      maturitySellPrice: 1e7,
      matureWeight: 200,
      moveProbability: 0.3,
      moveTweenDurationMs: 600,
      hoursToMature: 72,
      rarity: rarity.Legendary,
      tileTransformOrigin: "bottom",
      diet: ["Beet", "Pear", "Coconut"]
    },
    Horse: {
      tileRef: tileRefsPets.Horse,
      name: "Horse",
      coinsToFullyReplenishHunger: 25e3,
      innateAbilityWeights: {
        DawnBoost: 30,
        DawnlitGranter: 40,
        DawnPlantGrowthBoost: 10,
        PetAgeBoostII: 20
      },
      maxScale: 2.5,
      maturitySellPrice: 5e7,
      matureWeight: 80,
      moveProbability: 0.4,
      moveTweenDurationMs: 500,
      hoursToMature: 100,
      rarity: rarity.Legendary,
      tileTransformOrigin: "bottom",
      diet: ["Squash", "Echeveria", "Gentian"]
    },
    FireHorse: {
      tileRef: tileRefsPets.FireHorse,
      name: "Fire Horse",
      coinsToFullyReplenishHunger: 2e5,
      innateAbilityWeights: {
        AmberMoonBoost: 30,
        PetHatchSizeBoostII: 20,
        AmberlitGranter: 40,
        AmberPlantGrowthBoost: 10
      },
      maxScale: 2.5,
      maturitySellPrice: 15e7,
      matureWeight: 700,
      moveProbability: 0.4,
      moveTweenDurationMs: 800,
      hoursToMature: 144,
      rarity: rarity.Mythic,
      tileTransformOrigin: "bottom",
      diet: ["DragonFruit", "Poinsettia", "Cacao"]
    },
    Butterfly: {
      tileRef: tileRefsPets.Butterfly,
      name: "Butterfly",
      coinsToFullyReplenishHunger: 25e3,
      innateAbilityWeights: { ProduceScaleBoostII: 40, ProduceMutationBoostII: 40, SeedFinderIII: 20 },
      baseTileScale: 0.6,
      maxScale: 2.5,
      maturitySellPrice: 5e7,
      matureWeight: 0.2,
      moveProbability: 0.6,
      hoursToMature: 144,
      rarity: rarity.Mythic,
      tileTransformOrigin: "center",
      diet: ["Daffodil", "Lily", "Grape", "Lemon", "Sunflower"]
    },
    Capybara: {
      tileRef: tileRefsPets.Capybara,
      name: "Capybara",
      coinsToFullyReplenishHunger: 15e4,
      innateAbilityWeights: { DoubleHarvest: 50, ProduceRefund: 50 },
      baseTileScale: 1,
      maxScale: 2.5,
      maturitySellPrice: 2e8,
      matureWeight: 50,
      moveProbability: 0.2,
      hoursToMature: 144,
      rarity: rarity.Mythic,
      tileTransformOrigin: "bottom",
      nudgeY: -0.1,
      diet: ["Lemon", "PassionFruit", "DragonFruit", "Lychee"]
    },
    Peacock: {
      tileRef: tileRefsPets.Peacock,
      name: "Peacock",
      coinsToFullyReplenishHunger: 1e5,
      innateAbilityWeights: { SellBoostIV: 40, PetXpBoostII: 50, PetRefundII: 10 },
      baseTileScale: 1.2,
      maxScale: 2.5,
      maturitySellPrice: 1e8,
      matureWeight: 5,
      moveProbability: 0.2,
      hoursToMature: 144,
      rarity: rarity.Mythic,
      tileTransformOrigin: "bottom",
      nudgeY: -0.1,
      diet: ["Cactus", "Sunflower", "Lychee"]
    }
  };
  var toolCatalog = {
    WateringCan: {
      tileRef: tileRefsItems.WateringCan,
      name: "Watering Can",
      coinPrice: 5e3,
      creditPrice: 2,
      rarity: rarity.Common,
      description: "Speeds up growth of plant by 5 minutes. SINGLE USE.",
      isOneTimePurchase: false,
      baseTileScale: 0.6,
      maxInventoryQuantity: 99
    },
    PlanterPot: {
      tileRef: tileRefsItems.PlanterPot,
      name: "Planter Pot",
      coinPrice: 25e3,
      creditPrice: 5,
      rarity: rarity.Common,
      description: "Extract a plant to your inventory (can be replanted). SINGLE USE.",
      isOneTimePurchase: false,
      baseTileScale: 0.8
    },
    Shovel: {
      tileRef: tileRefsItems.Shovel,
      name: "Garden Shovel",
      coinPrice: 1e6,
      creditPrice: 100,
      rarity: rarity.Uncommon,
      description: "Remove plants from your garden. UNLIMITED USES.",
      isOneTimePurchase: true,
      baseTileScale: 0.7
    },
    RainbowPotion: {
      tileRef: tileRefsItems.RainbowPotion,
      name: "Rainbow Potion",
      coinPrice: 1 / 0,
      creditPrice: 1 / 0,
      rarity: rarity.Celestial,
      description: "Adds the Rainbow mutation to a crop in your garden. SINGLE USE.",
      isOneTimePurchase: true,
      baseTileScale: 1
    },
    CropCleanser: {
      tileRef: tileRefsItems.CropCleanser,
      name: "Crop Cleanser",
      coinPrice: 8e4,
      creditPrice: 7,
      rarity: rarity.Common,
      isOneTimePurchase: false,
      baseTileScale: 1,
      maxInventoryQuantity: 99
    }
  };
  var decorCatalog = {
    SmallRock: {
      tileRef: tileRefsDecor.SmallRock,
      name: "Small Garden Rock",
      coinPrice: 1e3,
      creditPrice: 2,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false
    },
    MediumRock: {
      tileRef: tileRefsDecor.MediumRock,
      name: "Medium Garden Rock",
      coinPrice: 2500,
      creditPrice: 5,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false
    },
    LargeRock: {
      tileRef: tileRefsDecor.LargeRock,
      name: "Large Garden Rock",
      coinPrice: 5e3,
      creditPrice: 10,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false
    },
    WoodCaribou: {
      tileRef: tileRefsDecor.WoodCaribou,
      name: "Wood Caribou",
      coinPrice: 9e3,
      creditPrice: 14,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false
    },
    WoodBench: {
      tileRef: tileRefsDecor.WoodBench,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.WoodBenchSideways, flipH: true, baseTileScale: 1.46, nudgeY: -0.3 },
        180: { tileRef: tileRefsDecor.WoodBenchBackwards },
        270: { tileRef: tileRefsDecor.WoodBenchSideways, baseTileScale: 1.46, nudgeY: -0.3 }
      },
      name: "Wood Bench",
      coinPrice: 1e4,
      creditPrice: 15,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false,
      nudgeY: -0.3,
      avatarNudgeY: -0.18
    },
    WoodArch: {
      tileRef: tileRefsDecor.WoodArch,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.WoodArchSide, flipH: true, baseTileScale: 2.1, nudgeY: -0.48 },
        180: { tileRef: tileRefsDecor.WoodArch, flipH: true },
        270: { tileRef: tileRefsDecor.WoodArchSide, baseTileScale: 2.1, nudgeY: -0.48 }
      },
      name: "Wood Arch",
      coinPrice: 2e4,
      creditPrice: 25,
      rarity: rarity.Common,
      baseTileScale: 1.53,
      isOneTimePurchase: false,
      nudgeY: -0.5
    },
    WoodBridge: {
      tileRef: tileRefsDecor.WoodBridge,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.WoodBridgeSideways, flipH: true, baseTileScale: 1.7, nudgeY: -0.28 },
        180: { tileRef: tileRefsDecor.WoodBridge, flipH: true },
        270: { tileRef: tileRefsDecor.WoodBridgeSideways, baseTileScale: 1.7, nudgeY: -0.28 }
      },
      name: "Wood Bridge",
      coinPrice: 4e4,
      creditPrice: 35,
      rarity: rarity.Common,
      baseTileScale: 1.22,
      isOneTimePurchase: false,
      nudgeY: -0.35,
      avatarNudgeY: -0.44
    },
    WoodLampPost: {
      tileRef: tileRefsDecor.WoodLampPost,
      name: "Wood Lamp Post",
      coinPrice: 8e4,
      creditPrice: 49,
      rarity: rarity.Common,
      baseTileScale: 1.5,
      isOneTimePurchase: false,
      nudgeY: -0.6
    },
    WoodOwl: {
      tileRef: tileRefsDecor.WoodOwl,
      name: "Wood Owl",
      coinPrice: 9e4,
      creditPrice: 59,
      rarity: rarity.Common,
      baseTileScale: 1.3,
      isOneTimePurchase: false,
      nudgeY: -0.4
    },
    WoodBirdhouse: {
      tileRef: tileRefsDecor.Birdhouse,
      name: "Wood Birdhouse",
      coinPrice: 1e5,
      creditPrice: 69,
      rarity: rarity.Common,
      baseTileScale: 1.5,
      isOneTimePurchase: false,
      nudgeY: -0.6
    },
    WoodWindmill: {
      tileRef: tileRefsDecor.WoodWindmill,
      name: "Wood Windmill",
      coinPrice: 5e5,
      creditPrice: 74,
      rarity: rarity.Common,
      baseTileScale: 1.5,
      isOneTimePurchase: false,
      nudgeY: -0.47
    },
    WoodPergola: {
      tileRef: tileRefsDecor.WoodPergola,
      name: "Wood Pergola",
      coinPrice: 3e4,
      creditPrice: 30,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false
    },
    StoneCaribou: {
      tileRef: tileRefsDecor.StoneCaribou,
      name: "Stone Caribou",
      coinPrice: 75e4,
      creditPrice: 72,
      rarity: rarity.Uncommon,
      baseTileScale: 1.2,
      isOneTimePurchase: false
    },
    StoneBench: {
      tileRef: tileRefsDecor.StoneBench,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.StoneBenchSideways, flipH: true, baseTileScale: 1.47, nudgeY: -0.3 },
        180: { tileRef: tileRefsDecor.StoneBench, flipH: true },
        270: { tileRef: tileRefsDecor.StoneBenchSideways, baseTileScale: 1.47, nudgeY: -0.3 }
      },
      name: "Stone Bench",
      coinPrice: 1e6,
      creditPrice: 75,
      rarity: rarity.Uncommon,
      baseTileScale: 1,
      isOneTimePurchase: false,
      nudgeY: -0.3,
      avatarNudgeY: -0.18
    },
    StoneArch: {
      tileRef: tileRefsDecor.StoneArch,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.StoneArchSideways, flipH: true, baseTileScale: 2.1, nudgeY: -0.44 },
        180: { tileRef: tileRefsDecor.StoneArch, flipH: true },
        270: { tileRef: tileRefsDecor.StoneArchSideways, baseTileScale: 2.1, nudgeY: -0.44 }
      },
      name: "Stone Arch",
      coinPrice: 4e6,
      creditPrice: 124,
      rarity: rarity.Uncommon,
      baseTileScale: 1.53,
      isOneTimePurchase: false,
      nudgeY: -0.5
    },
    StoneBridge: {
      tileRef: tileRefsDecor.StoneBridge,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.StoneBridgeSideways, flipH: true, baseTileScale: 1.7, nudgeY: -0.28 },
        180: { tileRef: tileRefsDecor.StoneBridge, flipH: true },
        270: { tileRef: tileRefsDecor.StoneBridgeSideways, baseTileScale: 1.7, nudgeY: -0.28 }
      },
      name: "Stone Bridge",
      coinPrice: 5e6,
      creditPrice: 179,
      rarity: rarity.Uncommon,
      baseTileScale: 1.22,
      isOneTimePurchase: false,
      nudgeY: -0.35,
      avatarNudgeY: -0.44
    },
    StoneLampPost: {
      tileRef: tileRefsDecor.StoneLampPost,
      name: "Stone Lamp Post",
      coinPrice: 8e6,
      creditPrice: 199,
      rarity: rarity.Uncommon,
      baseTileScale: 1.5,
      isOneTimePurchase: false,
      nudgeY: -0.6
    },
    StoneGnome: {
      tileRef: tileRefsDecor.StoneGnome,
      name: "Stone Gnome",
      coinPrice: 9e6,
      creditPrice: 219,
      rarity: rarity.Uncommon,
      baseTileScale: 1.3,
      isOneTimePurchase: false,
      nudgeY: -0.4
    },
    StoneBirdbath: {
      tileRef: tileRefsDecor.StoneBirdBath,
      name: "Stone Birdbath",
      coinPrice: 1e7,
      creditPrice: 249,
      rarity: rarity.Uncommon,
      baseTileScale: 1.2,
      isOneTimePurchase: false,
      nudgeY: -0.46
    },
    MarbleCaribou: {
      tileRef: tileRefsDecor.MarbleCaribou,
      name: "Marble Caribou",
      coinPrice: 5e7,
      creditPrice: 299,
      rarity: rarity.Rare,
      baseTileScale: 1.4,
      isOneTimePurchase: false
    },
    MarbleBench: {
      tileRef: tileRefsDecor.MarbleBench,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.MarbleBenchSideways, flipH: true, baseTileScale: 1.55, nudgeY: -0.35 },
        180: { tileRef: tileRefsDecor.MarbleBenchBackwards },
        270: { tileRef: tileRefsDecor.MarbleBenchSideways, baseTileScale: 1.55, nudgeY: -0.35 }
      },
      name: "Marble Bench",
      coinPrice: 75e6,
      creditPrice: 349,
      rarity: rarity.Rare,
      baseTileScale: 1,
      isOneTimePurchase: false,
      nudgeY: -0.3,
      avatarNudgeY: -0.18
    },
    MarbleArch: {
      tileRef: tileRefsDecor.MarbleArch,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.MarbleArchSideways, flipH: true, baseTileScale: 2.38, nudgeY: -0.57 },
        180: { tileRef: tileRefsDecor.MarbleArch, flipH: true },
        270: { tileRef: tileRefsDecor.MarbleArchSideways, baseTileScale: 2.38, nudgeY: -0.57 }
      },
      name: "Marble Arch",
      coinPrice: 1e8,
      creditPrice: 399,
      rarity: rarity.Rare,
      baseTileScale: 1.53,
      isOneTimePurchase: false,
      nudgeY: -0.5
    },
    MarbleBridge: {
      tileRef: tileRefsDecor.MarbleBridge,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.MarbleBridgeSideways, flipH: true, baseTileScale: 1.7, nudgeY: -0.28 },
        180: { tileRef: tileRefsDecor.MarbleBridge, flipH: true },
        270: { tileRef: tileRefsDecor.MarbleBridgeSideways, baseTileScale: 1.7, nudgeY: -0.28 }
      },
      name: "Marble Bridge",
      coinPrice: 15e7,
      creditPrice: 429,
      rarity: rarity.Rare,
      baseTileScale: 1.22,
      isOneTimePurchase: false,
      nudgeY: -0.35,
      avatarNudgeY: -0.44
    },
    MarbleLampPost: {
      tileRef: tileRefsDecor.MarbleLampPost,
      name: "Marble Lamp Post",
      coinPrice: 2e8,
      creditPrice: 449,
      rarity: rarity.Rare,
      baseTileScale: 1.5,
      isOneTimePurchase: false,
      nudgeY: -0.6
    },
    MarbleBlobling: {
      tileRef: tileRefsDecor.MarbleBlobling,
      name: "Marble Blobling",
      coinPrice: 3e8,
      creditPrice: 499,
      rarity: rarity.Rare,
      baseTileScale: 1.5,
      isOneTimePurchase: false,
      nudgeY: -0.56
    },
    MarbleFountain: {
      tileRef: tileRefsDecor.MarbleFountain,
      name: "Marble Fountain",
      coinPrice: 45e7,
      creditPrice: 449,
      rarity: rarity.Rare,
      baseTileScale: 1.5,
      isOneTimePurchase: false,
      nudgeY: -0.3
    },
    MiniFairyCottage: {
      tileRef: tileRefsDecor.MiniFairyCottage,
      name: "Mini Fairy Cottage",
      coinPrice: 5e8,
      creditPrice: 549,
      rarity: rarity.Rare,
      baseTileScale: 1.1,
      isOneTimePurchase: false,
      nudgeY: -0.37
    },
    Cauldron: {
      tileRef: tileRefsDecor.Cauldron,
      name: "Cauldron",
      coinPrice: 666e6,
      creditPrice: 666,
      rarity: rarity.Legendary,
      baseTileScale: 1.5,
      isOneTimePurchase: false,
      nudgeY: -0.25,
      expiryDate: /* @__PURE__ */ new Date("2025-11-07T01:00:00.000Z")
    },
    StrawScarecrow: {
      tileRef: tileRefsDecor.StrawScarecrow,
      name: "Straw Scarecrow",
      coinPrice: 1e9,
      creditPrice: 599,
      rarity: rarity.Legendary,
      baseTileScale: 1.8,
      isOneTimePurchase: false,
      nudgeY: -0.65
    },
    MiniFairyForge: {
      tileRef: tileRefsDecor.MiniFairyForge,
      name: "Mini Fairy Forge",
      coinPrice: 5e9,
      creditPrice: 979,
      rarity: rarity.Legendary,
      baseTileScale: 1,
      isOneTimePurchase: false,
      nudgeY: -0.3
    },
    MiniFairyKeep: {
      tileRef: tileRefsDecor.MiniFairyKeep,
      name: "Mini Fairy Keep",
      coinPrice: 25e9,
      creditPrice: 1249,
      rarity: rarity.Mythic,
      baseTileScale: 1.05,
      isOneTimePurchase: false,
      nudgeY: -0.33
    },
    PetHutch: {
      tileRef: tileRefsDecor.PetHutch,
      name: "Pet Hutch",
      coinPrice: 8e10,
      creditPrice: 499,
      rarity: rarity.Divine,
      baseTileScale: 2.1,
      isOneTimePurchase: true,
      nudgeY: -0.45
    },
    FeedingTrough: {
      tileRef: tileRefsDecor.FeedingTrough,
      name: "Feeding Trough",
      coinPrice: 1e7,
      creditPrice: 199,
      rarity: rarity.Rare,
      baseTileScale: 1.05,
      nudgeY: -0.45,
      isOneTimePurchase: true,
      avatarNudgeY: -0.25
    },
    DecorShed: {
      tileRef: tileRefsDecor.DecorShed,
      name: "Decor Shed",
      coinPrice: 6e10,
      creditPrice: 399,
      rarity: rarity.Divine,
      baseTileScale: 1,
      isOneTimePurchase: true
    },
    SeedSilo: {
      tileRef: tileRefsDecor.SeedSilo,
      name: "Seed Silo",
      coinPrice: 1e11,
      creditPrice: 699,
      rarity: rarity.Divine,
      baseTileScale: 1,
      isOneTimePurchase: true
    },
    MiniWizardTower: {
      tileRef: tileRefsDecor.MiniWizardTower,
      name: "Mini Wizard Tower",
      coinPrice: 75e9,
      creditPrice: 1379,
      rarity: rarity.Mythic,
      baseTileScale: 1.8,
      isOneTimePurchase: false,
      nudgeY: -0.59
    },
    HayBale: {
      tileRef: tileRefsDecor.HayBale,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.HayBaleSideways, flipH: true },
        180: { tileRef: tileRefsDecor.HayBale, flipH: true },
        270: { tileRef: tileRefsDecor.HayBaleSideways }
      },
      name: "Hay Bale",
      coinPrice: 7e3,
      creditPrice: 12,
      rarity: rarity.Common,
      baseTileScale: 1.8,
      isOneTimePurchase: false,
      nudgeY: -0.42,
      expiryDate: /* @__PURE__ */ new Date("2025-11-07T01:00:00.000Z")
    },
    StringLights: {
      tileRef: tileRefsDecor.StringLights,
      rotationVariants: {
        90: {
          tileRef: tileRefsDecor.StringLightsSideways,
          flipH: true
        },
        180: {
          tileRef: tileRefsDecor.StringLights,
          flipH: true
        },
        270: {
          tileRef: tileRefsDecor.StringLightsSideways
        }
      },
      name: "String Lights",
      coinPrice: 7e3,
      creditPrice: 12,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false
    },
    ColoredStringLights: {
      tileRef: tileRefsDecor.ColoredStringLights,
      rotationVariants: {
        90: {
          tileRef: tileRefsDecor.ColoredStringLightsSideways,
          flipH: true
        },
        180: {
          tileRef: tileRefsDecor.ColoredStringLights,
          flipH: true
        },
        270: {
          tileRef: tileRefsDecor.ColoredStringLightsSideways
        }
      },
      name: "Colored String Lights",
      coinPrice: 8e3,
      creditPrice: 13,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false
    },
    PaperLantern: {
      tileRef: tileRefsDecor.PaperLantern,
      rotationVariants: {
        90: {
          tileRef: tileRefsDecor.PaperLanternSideways,
          flipH: true
        },
        180: {
          tileRef: tileRefsDecor.PaperLantern,
          flipH: true
        },
        270: {
          tileRef: tileRefsDecor.PaperLanternSideways
        }
      },
      name: "Paper Lantern",
      coinPrice: 9e3,
      creditPrice: 13,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false
    },
    FanousLantern: {
      tileRef: tileRefsDecor.FanousLantern,
      rotationVariants: {
        90: {
          tileRef: tileRefsDecor.FanousLanternSideways,
          flipH: true
        },
        180: {
          tileRef: tileRefsDecor.FanousLantern,
          flipH: true
        },
        270: {
          tileRef: tileRefsDecor.FanousLanternSideways
        }
      },
      name: "Fanous Lantern",
      coinPrice: 9e3,
      creditPrice: 13,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false
    },
    SmallGravestone: {
      tileRef: tileRefsDecor.SmallGravestone,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.SmallGravestoneSideways, flipH: true, baseTileScale: 1.12, nudgeY: -0.32 },
        180: { tileRef: tileRefsDecor.SmallGravestone, flipH: true },
        270: { tileRef: tileRefsDecor.SmallGravestoneSideways, baseTileScale: 1.12, nudgeY: -0.32 }
      },
      name: "Small Gravestone",
      coinPrice: 8e3,
      creditPrice: 12,
      rarity: rarity.Common,
      baseTileScale: 1,
      isOneTimePurchase: false,
      nudgeY: -0.38,
      expiryDate: /* @__PURE__ */ new Date("2025-11-07T01:00:00.000Z")
    },
    MediumGravestone: {
      tileRef: tileRefsDecor.MediumGravestone,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.MediumGravestoneSideways, flipH: true, baseTileScale: 1.32, nudgeY: -0.33 },
        180: { tileRef: tileRefsDecor.MediumGravestone, flipH: true },
        270: { tileRef: tileRefsDecor.MediumGravestoneSideways, baseTileScale: 1.32, nudgeY: -0.33 }
      },
      name: "Medium Gravestone",
      coinPrice: 5e5,
      creditPrice: 72,
      rarity: rarity.Uncommon,
      baseTileScale: 1.2,
      isOneTimePurchase: false,
      nudgeY: -0.45,
      expiryDate: /* @__PURE__ */ new Date("2025-11-07T01:00:00.000Z")
    },
    LargeGravestone: {
      tileRef: tileRefsDecor.LargeGravestone,
      rotationVariants: {
        90: { tileRef: tileRefsDecor.LargeGravestoneSideways, flipH: true, baseTileScale: 1.5, nudgeY: -0.39 },
        180: { tileRef: tileRefsDecor.LargeGravestone, flipH: true },
        270: { tileRef: tileRefsDecor.LargeGravestoneSideways, baseTileScale: 1.5, nudgeY: -0.39 }
      },
      name: "Large Gravestone",
      coinPrice: 5e7,
      creditPrice: 299,
      rarity: rarity.Rare,
      baseTileScale: 1.4,
      isOneTimePurchase: false,
      nudgeY: -0.51,
      expiryDate: /* @__PURE__ */ new Date("2025-11-07T01:00:00.000Z")
    }
  };

  // src/store/bridge.ts
  var STORE_BRIDGE_GLOBAL = "__MG_STORE_BRIDGE__";
  function getBridge() {
    const bridge = pageWindow[STORE_BRIDGE_GLOBAL];
    if (bridge && typeof bridge === "object" && typeof bridge.promise?.then === "function") {
      return bridge;
    }
    return null;
  }
  function acquireSharedStore(owner, capture) {
    const existing = getBridge();
    if (existing) return existing.promise;
    const promise = capture().then((store) => {
      if (store.__polyfill) {
        const current = getBridge();
        if (current && current.promise === promise) {
          delete pageWindow[STORE_BRIDGE_GLOBAL];
        }
      }
      return store;
    });
    pageWindow[STORE_BRIDGE_GLOBAL] = {
      version: 1,
      owner,
      promise
    };
    return promise;
  }

  // src/store/jotai.ts
  var _store = null;
  var _captureInProgress = false;
  var _captureError = null;
  var _lastCapturedVia = null;
  var ATOM_CACHE_WAIT_MS = 2e4;
  var WRITE_ONCE_MS = 5e3;
  var getAtomCache = () => pageWindow.jotaiAtomCache?.cache;
  async function waitForAtomCache() {
    const t0 = Date.now();
    while (Date.now() - t0 < ATOM_CACHE_WAIT_MS) {
      const cache = getAtomCache();
      if (cache) return cache;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }
  function findStoreViaFiber() {
    const hook = pageWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook?.renderers?.size) return null;
    for (const [rid] of hook.renderers) {
      const roots = hook.getFiberRoots?.(rid);
      if (!roots) continue;
      for (const root of roots) {
        const seen = /* @__PURE__ */ new Set();
        const stack = [root.current];
        while (stack.length) {
          const f = stack.pop();
          if (!f || seen.has(f)) continue;
          seen.add(f);
          const v = f?.pendingProps?.value;
          if (v && typeof v.get === "function" && typeof v.set === "function" && typeof v.sub === "function") {
            _lastCapturedVia = "fiber";
            return v;
          }
          if (f.child) stack.push(f.child);
          if (f.sibling) stack.push(f.sibling);
          if (f.alternate) stack.push(f.alternate);
        }
      }
    }
    return null;
  }
  function makePolyfillStore() {
    return {
      get: () => {
        throw new Error("Store non captur\xE9: get indisponible");
      },
      set: () => {
        throw new Error("Store non captur\xE9: set indisponible");
      },
      sub: () => () => {
      },
      __polyfill: true
    };
  }
  async function captureViaWriteOnce() {
    let cache = getAtomCache() ?? null;
    if (!cache) {
      console.log("[jotai-bridge] Waiting for jotaiAtomCache...");
      cache = await waitForAtomCache();
    }
    if (!cache) {
      console.warn("[jotai-bridge] jotaiAtomCache.cache introuvable");
      _lastCapturedVia = "polyfill";
      return makePolyfillStore();
    }
    let capturedGet = null;
    let capturedSet = null;
    const patched = [];
    const restorePatched = () => {
      for (const a of patched) {
        try {
          if (a.__origWrite) {
            a.write = a.__origWrite;
            delete a.__origWrite;
          }
        } catch {
        }
      }
    };
    for (const atom of cache.values()) {
      if (!atom || typeof atom.write !== "function" || atom.__origWrite) continue;
      const orig = atom.write;
      atom.__origWrite = orig;
      atom.write = function(get, set2, ...args) {
        if (!capturedSet) {
          capturedGet = get;
          capturedSet = set2;
          restorePatched();
        }
        return orig.call(this, get, set2, ...args);
      };
      patched.push(atom);
    }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const t0 = Date.now();
    try {
      pageWindow.dispatchEvent?.(new pageWindow.Event("visibilitychange"));
    } catch {
    }
    while (!capturedSet && Date.now() - t0 < WRITE_ONCE_MS) {
      await wait(50);
    }
    if (!capturedSet) {
      restorePatched();
      _lastCapturedVia = "polyfill";
      console.warn("[jotai-bridge] write-once: timeout \u2192 polyfill");
      return {
        get: () => {
          throw new Error("Store non captur\xE9: get indisponible");
        },
        set: () => {
          throw new Error("Store non captur\xE9: set indisponible");
        },
        sub: () => () => {
        },
        __polyfill: true
      };
    }
    _lastCapturedVia = "write";
    return {
      get: (a) => capturedGet(a),
      set: (a, v) => capturedSet(a, v),
      sub: (a, cb) => {
        let last;
        try {
          last = capturedGet(a);
        } catch {
        }
        const id = setInterval(() => {
          let curr;
          try {
            curr = capturedGet(a);
          } catch {
            return;
          }
          if (curr !== last) {
            last = curr;
            try {
              cb();
            } catch {
            }
          }
        }, 100);
        return () => clearInterval(id);
      }
    };
  }
  var STORE_OWNER = "seed-deleter-mod";
  async function rawCapture() {
    const viaFiber = findStoreViaFiber();
    if (viaFiber) return viaFiber;
    return captureViaWriteOnce();
  }
  async function ensureStore() {
    if (_store && !_store.__polyfill) return _store;
    if (_captureInProgress) {
      const t0 = Date.now();
      const maxWait = ATOM_CACHE_WAIT_MS + WRITE_ONCE_MS + 1e3;
      while (!_store && Date.now() - t0 < maxWait) {
        await new Promise((r) => setTimeout(r, 25));
      }
      if (_store && !_store.__polyfill) return _store;
    }
    _captureInProgress = true;
    try {
      _store = await acquireSharedStore(STORE_OWNER, rawCapture);
      return _store;
    } catch (e) {
      _captureError = e;
      throw e;
    } finally {
      _captureInProgress = false;
    }
  }
  async function jGet(atom) {
    const s = await ensureStore();
    return s.get(atom);
  }
  async function jSet(atom, value) {
    const s = await ensureStore();
    await s.set(atom, value);
  }
  async function jSub(atom, cb) {
    const s = await ensureStore();
    return s.sub(atom, cb);
  }
  function findAtomsByLabel(regex) {
    const cache = getAtomCache();
    if (!cache) return [];
    const out = [];
    for (const a of cache.values()) {
      const label = a?.debugLabel || a?.label || "";
      if (regex.test(String(label))) out.push(a);
    }
    return out;
  }
  function getAtomByLabel(label) {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return findAtomsByLabel(new RegExp("^" + escape(label) + "$"))[0] || null;
  }

  // src/store/api.ts
  var ATOM_POLL_MS = 250;
  var ATOM_WAIT_TIMEOUT_MS = 10 * 6e4;
  var pendingWaiters = /* @__PURE__ */ new Set();
  var pollTimer = null;
  function stopPoller() {
    if (pollTimer === null) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }
  function pollPendingWaiters() {
    const now = Date.now();
    for (const waiter of Array.from(pendingWaiters)) {
      const atom = getAtomByLabel(waiter.label);
      if (atom) {
        pendingWaiters.delete(waiter);
        waiter.resolve(atom);
        continue;
      }
      if (now >= waiter.expiresAt) {
        pendingWaiters.delete(waiter);
        waiter.resolve(null);
      }
    }
    if (!pendingWaiters.size) stopPoller();
  }
  function ensurePoller() {
    if (pollTimer !== null) return;
    pollTimer = setInterval(pollPendingWaiters, ATOM_POLL_MS);
  }
  function waitForAtom(label) {
    return new Promise((resolve) => {
      const waiter = {
        label,
        expiresAt: Date.now() + ATOM_WAIT_TIMEOUT_MS,
        resolve
      };
      pendingWaiters.add(waiter);
      ensurePoller();
    });
  }
  async function ensureStore2() {
    try {
      await ensureStore();
    } catch {
    }
  }
  async function select(label, fallback) {
    await ensureStore2();
    const atom = getAtomByLabel(label);
    if (!atom) return fallback;
    try {
      return await jGet(atom);
    } catch {
      return fallback;
    }
  }
  async function hasAtom(label) {
    await ensureStore2();
    return !!getAtomByLabel(label);
  }
  async function subscribe(label, cb) {
    await ensureStore2();
    let cancelled = false;
    let attachedUnsub = null;
    const attach = async (atom2) => {
      const unsub = await jSub(atom2, async () => {
        try {
          cb(await jGet(atom2));
        } catch {
        }
      });
      if (cancelled) {
        try {
          unsub();
        } catch {
        }
        return;
      }
      attachedUnsub = unsub;
    };
    const atom = getAtomByLabel(label);
    if (atom) {
      await attach(atom);
    } else {
      void (async () => {
        const found = await waitForAtom(label);
        if (!found || cancelled) return;
        try {
          await attach(found);
        } catch {
        }
      })();
    }
    return () => {
      cancelled = true;
      const unsub = attachedUnsub;
      attachedUnsub = null;
      try {
        unsub?.();
      } catch {
      }
    };
  }
  async function subscribeImmediate(label, cb) {
    await ensureStore2();
    let cancelled = false;
    let attachedUnsub = null;
    const attach = async (atom2) => {
      const unsub = await jSub(atom2, async () => {
        try {
          cb(await jGet(atom2));
        } catch {
        }
      });
      if (cancelled) {
        try {
          unsub();
        } catch {
        }
        return;
      }
      attachedUnsub = unsub;
      try {
        const current = await jGet(atom2);
        if (!cancelled && current !== void 0) cb(current);
      } catch {
      }
    };
    const atom = getAtomByLabel(label);
    if (atom) {
      await attach(atom);
    } else {
      void (async () => {
        const found = await waitForAtom(label);
        if (!found || cancelled) return;
        try {
          await attach(found);
        } catch {
        }
      })();
    }
    return () => {
      cancelled = true;
      const unsub = attachedUnsub;
      attachedUnsub = null;
      try {
        unsub?.();
      } catch {
      }
    };
  }
  async function set(label, value) {
    await ensureStore2();
    const atom = getAtomByLabel(label);
    if (!atom) return;
    await jSet(atom, value);
  }
  var Store = { ensure: ensureStore2, select, subscribe, subscribeImmediate, set, hasAtom };

  // src/store/hub.ts
  function toPathArray(path) {
    if (!path) return [];
    return Array.isArray(path) ? path.slice() : path.split(".").map((k) => k.match(/^\d+$/) ? Number(k) : k);
  }
  function getAtPath(root, path) {
    const segs = toPathArray(path);
    let cur = root;
    for (const s of segs) {
      if (cur == null) return void 0;
      cur = cur[s];
    }
    return cur;
  }
  function setAtPath(root, path, nextValue) {
    const segs = toPathArray(path);
    if (!segs.length) return nextValue;
    const clone = Array.isArray(root) ? root.slice() : { ...root ?? {} };
    let cur = clone;
    for (let i = 0; i < segs.length - 1; i++) {
      const key = segs[i];
      const src = cur[key];
      const obj = typeof src === "object" && src !== null ? Array.isArray(src) ? src.slice() : { ...src } : {};
      cur[key] = obj;
      cur = obj;
    }
    cur[segs[segs.length - 1]] = nextValue;
    return clone;
  }
  function makeView(sourceLabel, opts = {}) {
    const { path, write = "replace" } = opts;
    async function get() {
      const src = await Store.select(sourceLabel);
      return path ? getAtPath(src, path) : src;
    }
    async function set2(next) {
      if (typeof write === "function") {
        const prev2 = await Store.select(sourceLabel);
        const raw2 = write(next, prev2);
        return Store.set(sourceLabel, raw2);
      }
      const prev = await Store.select(sourceLabel);
      const raw = path ? setAtPath(prev, path, next) : next;
      if (write === "merge-shallow" && !path && prev && typeof prev === "object" && typeof next === "object") {
        return Store.set(sourceLabel, { ...prev, ...next });
      }
      return Store.set(sourceLabel, raw);
    }
    async function update(fn) {
      const prev = await get();
      const next = fn(prev);
      await set2(next);
      return next;
    }
    async function onChange(cb, isEqual = Object.is) {
      let prev;
      return Store.subscribe(sourceLabel, (src) => {
        const v = path ? getAtPath(src, path) : src;
        if (typeof prev === "undefined" || !isEqual(prev, v)) {
          const p = prev;
          prev = v;
          cb(v, p);
        }
      });
    }
    async function onChangeNow(cb, isEqual = Object.is) {
      let prev;
      return Store.subscribeImmediate(sourceLabel, (src) => {
        const v = path ? getAtPath(src, path) : src;
        if (typeof prev === "undefined" || !isEqual(prev, v)) {
          const p = prev;
          prev = v;
          cb(v, p);
        }
      });
    }
    function asSignature(opts2) {
      return makeSignatureChannel(sourceLabel, path, opts2);
    }
    return { label: sourceLabel + (path ? ":" + toPathArray(path).join(".") : ""), get, set: set2, update, onChange, onChangeNow, asSignature };
  }
  function stablePick(obj, fields) {
    const out = {};
    for (const f of fields) {
      const v = getAtPath(obj, f.includes(".") ? f : [f]);
      out[f] = v;
    }
    try {
      return JSON.stringify(out);
    } catch {
      return String(out);
    }
  }
  function makeSignatureChannel(sourceLabel, path, opts) {
    const mode = opts.mode ?? "auto";
    function computeSig(whole) {
      const base = whole;
      const value = path ? getAtPath(base, path) : base;
      const sig = /* @__PURE__ */ new Map();
      if (value == null) return { sig, keys: [] };
      if ((mode === "array" || mode === "auto" && Array.isArray(value)) && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          const key = opts.key ? opts.key(item, i, whole) : i;
          const s = opts.sig ? opts.sig(item, i, whole) : opts.fields ? stablePick(item, opts.fields) : (() => {
            try {
              return JSON.stringify(item);
            } catch {
              return String(item);
            }
          })();
          sig.set(key, s);
        }
      } else {
        for (const [k, item] of Object.entries(value)) {
          const key = opts.key ? opts.key(item, k, whole) : k;
          const s = opts.sig ? opts.sig(item, k, whole) : opts.fields ? stablePick(item, opts.fields) : (() => {
            try {
              return JSON.stringify(item);
            } catch {
              return String(item);
            }
          })();
          sig.set(key, s);
        }
      }
      return { sig, keys: Array.from(sig.keys()) };
    }
    function mapEqual(a, b) {
      if (a === b) return true;
      if (!a || !b || a.size !== b.size) return false;
      for (const [k, v] of a) if (b.get(k) !== v) return false;
      return true;
    }
    async function sub(cb) {
      let prevSig = null;
      return Store.subscribeImmediate(sourceLabel, (src) => {
        const whole = path ? getAtPath(src, path) : src;
        const { sig } = computeSig(whole);
        if (!mapEqual(prevSig, sig)) {
          const allKeys = /* @__PURE__ */ new Set([
            ...prevSig ? Array.from(prevSig.keys()) : [],
            ...Array.from(sig.keys())
          ]);
          const changed = [];
          for (const k of allKeys) if ((prevSig?.get(k) ?? "__NONE__") !== (sig.get(k) ?? "__NONE__")) changed.push(k);
          prevSig = sig;
          cb({ value: whole, changedKeys: changed });
        }
      });
    }
    async function subKey(key, cb) {
      let last = "__INIT__";
      return sub(({ value, changedKeys }) => {
        if (changedKeys.includes(key)) cb({ value });
      });
    }
    async function subKeys(keys, cb) {
      const wanted = new Set(keys);
      return sub(({ value, changedKeys }) => {
        const hit = changedKeys.filter((k) => wanted.has(k));
        if (hit.length) cb({ value, changedKeys: hit });
      });
    }
    return { sub, subKey, subKeys };
  }
  function makeAtom(label) {
    return makeView(label);
  }
  function makeAliasedAtom(labels) {
    let resolved = null;
    async function pick() {
      if (resolved) return resolved;
      for (const label of labels) {
        if (await Store.hasAtom(label)) {
          resolved = makeView(label);
          return resolved;
        }
      }
      return makeView(labels[0]);
    }
    return {
      label: labels[0],
      get: async () => (await pick()).get(),
      set: async (next) => (await pick()).set(next),
      update: async (fn) => (await pick()).update(fn),
      onChange: async (cb, isEqual) => (await pick()).onChange(cb, isEqual),
      onChangeNow: async (cb, isEqual) => (await pick()).onChangeNow(cb, isEqual),
      asSignature: (opts) => makeView(resolved?.label ?? labels[0]).asSignature(opts)
    };
  }

  // src/store/atoms.ts
  var myData = makeAtom("myDataAtom");
  var myInventory = makeAtom("myInventoryAtom");
  var mySeedInventory = makeAtom("mySeedInventoryAtom");
  var mySelectedItemName = makeAtom("mySelectedItemNameAtom");
  var mySelectedItemId = makeAtom("mySelectedItemIdAtom");
  var myValidatedSelectedItemIndex = makeAtom("myValidatedSelectedItemIndexAtom");
  var myPossiblyNoLongerValidSelectedItemIndex = makeAtom("myPossiblyNoLongerValidSelectedItemIndexAtom");
  var activeModal = makeAliasedAtom([
    "activeModalStateAtom",
    "activeModalAtom"
  ]);
  var inventoryModalIsActive = makeAtom("inventoryModalIsActiveAtom");
  var Atoms = {
    ui: { activeModal, inventoryModalIsActive },
    data: { myData },
    inventory: {
      myInventory,
      mySeedInventory,
      mySelectedItemId,
      mySelectedItemName,
      myPossiblyNoLongerValidSelectedItemIndex,
      myValidatedSelectedItemIndex
    }
  };

  // src/core/sendToGame.ts
  function postAllToWorkers(msg) {
    if (Workers.forEach) Workers.forEach((w) => {
      try {
        w.postMessage(msg);
      } catch {
      }
    });
    else for (const w of Workers._a) {
      try {
        w.postMessage(msg);
      } catch {
      }
    }
  }
  function getPageWS() {
    if (quinoaWS && quinoaWS.readyState === NativeWS.OPEN) return quinoaWS;
    let any = null;
    if (sockets.find) any = sockets.find((s) => s.readyState === NativeWS.OPEN) || null;
    if (!any) {
      for (let i = 0; i < sockets.length; i++) if (sockets[i].readyState === NativeWS.OPEN) {
        any = sockets[i];
        break;
      }
    }
    if (any) {
      setQWS(any, "getPageWS");
      return any;
    }
    throw new Error("No page WebSocket open");
  }
  function sendToGame(payloadObj) {
    const msg = { scopePath: ["Room", "Quinoa"], ...payloadObj };
    try {
      const ws = getPageWS();
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      postAllToWorkers({ __QWS_CMD: "send", payload: JSON.stringify(msg) });
      return true;
    }
  }

  // src/services/fakeAtoms.ts
  var _fakeRegistry = /* @__PURE__ */ new Map();
  function _atomsByExactLabel(label) {
    try {
      return findAtomsByLabel(new RegExp("^" + label + "$"));
    } catch {
      return [];
    }
  }
  function _findReadKey(atom) {
    if (atom && typeof atom.read === "function") return "read";
    for (const k of Object.keys(atom || {})) {
      const v = atom[k];
      if (typeof v === "function" && k !== "write" && k !== "onMount" && k !== "toString") {
        const ar = v.length;
        if (ar === 1 || ar === 2) return k;
      }
    }
    throw new Error("Impossible de localiser la fonction read() de l'atom");
  }
  function _getState(label) {
    return _fakeRegistry.get(label) || null;
  }
  async function _forceRepaintViaGate(gate) {
    if (!gate?.closeAction || !gate?.openAction) return;
    await gate.closeAction();
    await new Promise((r) => setTimeout(r, 0));
    await gate.openAction();
  }
  async function _ensureFakeInstalled(config) {
    const key = config.label;
    const existing = _fakeRegistry.get(key);
    if (existing?.installed) return existing;
    const atoms = _atomsByExactLabel(config.label);
    if (!atoms.length) {
      throw new Error(`${config.label} introuvable`);
    }
    const state = existing ?? {
      config,
      enabled: false,
      payload: null,
      patched: /* @__PURE__ */ new Map(),
      installed: false
    };
    let gateAtom = null;
    if (config.gate?.label) gateAtom = getAtomByLabel(config.gate.label);
    for (const a of atoms) {
      const readKey = _findReadKey(a);
      const orig = a[readKey];
      a[readKey] = (get) => {
        try {
          if (gateAtom) get(gateAtom);
        } catch (err) {
        }
        for (const dep of config.extraDeps || []) {
          try {
            const d = getAtomByLabel(dep);
            d && get(d);
          } catch (err) {
          }
        }
        const real = orig(get);
        if (!state.enabled || state.payload == null) return real;
        return config.merge ? config.merge(real, state.payload) : state.payload;
      };
      state.patched.set(a, { readKey, orig });
    }
    if (gateAtom && config.gate?.autoDisableOnClose) {
      state.unsubGate = await jSub(gateAtom, async () => {
        let v;
        try {
          v = await jGet(gateAtom);
        } catch (err) {
          v = null;
        }
        const isOpen = config.gate?.isOpen ? config.gate.isOpen(v) : !!v;
        if (!isOpen && state.enabled) state.enabled = false;
      });
    }
    state.installed = true;
    _fakeRegistry.set(key, state);
    return state;
  }
  async function _primePatched(st) {
    const store = await ensureStore();
    for (const atom of st.patched.keys()) {
      try {
        store.get(atom);
      } catch {
      }
    }
  }
  async function fakeShow(config, payload, options) {
    await ensureStore();
    const st = await _ensureFakeInstalled(config);
    st.payload = payload;
    st.enabled = true;
    if (options?.merge && !config.merge) {
      config.merge = (_real, fake) => fake;
    }
    await _primePatched(st);
    if (options?.openGate && config.gate?.openAction) await config.gate.openAction();
    if (st.autoTimer) {
      clearTimeout(st.autoTimer);
      st.autoTimer = null;
    }
    if (options?.autoRestoreMs && options.autoRestoreMs > 0) {
      st.autoTimer = setTimeout(() => {
        void fakeHide(config.label);
      }, options.autoRestoreMs);
    }
  }
  async function fakeHide(label) {
    const st = _getState(label);
    if (!st) return;
    st.enabled = false;
    st.payload = null;
    if (st.autoTimer) {
      clearTimeout(st.autoTimer);
      st.autoTimer = null;
    }
    await _forceRepaintViaGate(st.config.gate);
  }

  // src/services/fakeModal.ts
  async function openModal(modalId) {
    try {
      const current = await Atoms.ui.activeModal.get();
      if (current && current !== modalId) {
        await Atoms.ui.activeModal.set(null);
        await Atoms.ui.inventoryModalIsActive.set(false);
        await new Promise((r) => requestAnimationFrame(r));
      }
      await Atoms.ui.activeModal.set(modalId);
      await Atoms.ui.inventoryModalIsActive.set(modalId === "inventory");
    } catch {
    }
  }
  async function closeModal(modalId) {
    try {
      if (modalId) {
        const current = await Atoms.ui.activeModal.get();
        if (current !== modalId) return;
      }
      await Atoms.ui.activeModal.set(null);
      if (modalId === "inventory" || !modalId) {
        await Atoms.ui.inventoryModalIsActive.set(false);
      }
    } catch {
    }
  }
  function isModalOpen(value, modalId) {
    return value === modalId;
  }
  async function isModalOpenAsync(modalId) {
    try {
      const v = await Atoms.ui.activeModal.get();
      return isModalOpen(v, modalId);
    } catch {
      return false;
    }
  }
  async function waitModalClosed(modalId, timeoutMs = 12e4) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      try {
        const v = await Atoms.ui.activeModal.get();
        if (!isModalOpen(v, modalId)) return true;
      } catch {
        return true;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    return false;
  }
  function gateForModal(modalId) {
    return {
      label: Atoms.ui.activeModal.label,
      isOpen: (v) => isModalOpen(v, modalId),
      openAction: () => openModal(modalId),
      closeAction: () => closeModal(modalId),
      autoDisableOnClose: true
    };
  }
  var mergeMyData = (real, patch) => {
    const base = real && typeof real === "object" ? real : {};
    const add = patch && typeof patch === "object" ? patch : {};
    return { ...base, ...add };
  };
  var SHARED_MYDATA_PATCH = {
    label: Atoms.data.myData.label,
    merge: mergeMyData,
    gate: gateForModal("inventory")
  };
  var INVENTORY_ATOM_PATCH = {
    label: Atoms.inventory.myInventory.label,
    merge: (_real, fake) => fake,
    gate: gateForModal("inventory")
  };
  var INVENTORY_MODAL_ID = "inventory";
  async function openInventoryPanel() {
    return openModal(INVENTORY_MODAL_ID);
  }
  async function closeInventoryPanel() {
    return closeModal(INVENTORY_MODAL_ID);
  }
  async function isInventoryPanelOpen() {
    return isModalOpenAsync(INVENTORY_MODAL_ID);
  }
  async function waitInventoryPanelClosed(timeoutMs = 12e4) {
    return waitModalClosed(INVENTORY_MODAL_ID, timeoutMs);
  }
  async function fakeInventoryShow(payload, opts) {
    const shouldOpen = opts?.open !== false;
    await fakeShow(SHARED_MYDATA_PATCH, { inventory: payload }, {
      openGate: false,
      autoRestoreMs: opts?.autoRestoreMs
    });
    await fakeShow(INVENTORY_ATOM_PATCH, payload, {
      openGate: false,
      autoRestoreMs: opts?.autoRestoreMs
    });
    if (shouldOpen) await openInventoryPanel();
  }
  async function fakeInventoryHide() {
    await fakeHide(INVENTORY_ATOM_PATCH.label);
    await fakeHide(SHARED_MYDATA_PATCH.label);
    await closeInventoryPanel();
  }

  // src/ui/toast.ts
  async function sendToast(toast) {
    const sendAtom = getAtomByLabel("sendQuinoaToastAtom");
    if (sendAtom) {
      await jSet(sendAtom, toast);
      return;
    }
    const listAtom = getAtomByLabel("quinoaToastsAtom");
    if (!listAtom) throw new Error("Aucun atom de toast trouv\xE9");
    const prev = await jGet(listAtom).catch(() => []);
    const isAnnouncement = "toastType" in toast && toast.toastType === "shopAnnouncement";
    const t = isAnnouncement ? { isClosable: true, presentByServerMs: Date.now(), ...toast } : { isClosable: true, duration: 1e4, ...toast };
    t.id = t.id ?? `quinoa-game-toast-${Date.now()}-${Math.random()}`;
    await jSet(listAtom, [...prev, t]);
  }
  async function toastSimple(title, description, variant = "info", duration = 3500) {
    await sendToast({ title, description, variant, duration });
  }

  // src/utils/format.ts
  var NF_US = new Intl.NumberFormat("en-US");
  var formatNum = (n) => NF_US.format(Math.max(0, Math.floor(n || 0)));
  var EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS = 10;
  function formatDurationShort(ms) {
    if (ms < 1e3) return `${ms} ms`;
    const seconds = ms / 1e3;
    if (seconds < 10) return `${seconds.toFixed(1)} s`;
    return `${Math.round(seconds)} s`;
  }
  function formatFinishTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // src/services/seedDeleter.ts
  async function wish(itemId) {
    try {
      sendToGame({ type: "Wish", itemId });
    } catch {
    }
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function buildDisplayNameToSpeciesFromCatalog() {
    const map = /* @__PURE__ */ new Map();
    try {
      const cat = plantCatalog;
      for (const species of Object.keys(cat || {})) {
        const seedName = cat?.[species]?.seed?.name && String(cat?.[species]?.seed?.name) || `${species} Seed`;
        const arr = map.get(seedName) ?? [];
        arr.push(species);
        map.set(seedName, arr);
      }
    } catch {
    }
    return map;
  }
  function seedDisplayNameFromSpecies(species) {
    try {
      const node = plantCatalog?.[species];
      const n = node?.seed?.name;
      if (typeof n === "string" && n) return n;
    } catch {
    }
    return `${species} Seed`;
  }
  function normalizeSeedItem(x) {
    if (!x || typeof x !== "object") return null;
    const species = typeof x.species === "string" ? x.species.trim() : "";
    const itemType = x.itemType === "Seed" ? "Seed" : null;
    const quantity = Number.isFinite(x.quantity) ? Math.max(0, Math.floor(x.quantity)) : 0;
    if (!species || itemType !== "Seed" || quantity <= 0) return null;
    return { species, itemType: "Seed", quantity, id: `seed:${species}` };
  }
  async function getMySeedInventory() {
    try {
      const raw = await Atoms.inventory.mySeedInventory.get();
      if (!Array.isArray(raw)) return [];
      const out = [];
      raw.forEach((x) => {
        const s = normalizeSeedItem(x);
        if (s) out.push(s);
      });
      return out;
    } catch {
      return [];
    }
  }
  function buildInventoryShapeFrom(items) {
    return { items, favoritedItemIds: [] };
  }
  async function buildSpeciesStockFromInventory() {
    const inv = await getMySeedInventory();
    const stock = /* @__PURE__ */ new Map();
    for (const it of inv) {
      const q = Math.max(0, Math.floor(it.quantity || 0));
      if (q > 0) stock.set(it.species, (stock.get(it.species) ?? 0) + q);
    }
    return stock;
  }
  function allocateForRequestedName(requested, nameToSpecies, speciesStock) {
    let remaining = Math.max(0, Math.floor(requested.qty || 0));
    let candidates = nameToSpecies.get(requested.name) ?? [];
    if (!candidates.length && / seed$/i.test(requested.name)) {
      const fallbackSpecies = requested.name.replace(/\s+seed$/i, "");
      if (plantCatalog?.[fallbackSpecies]) candidates = [fallbackSpecies];
    }
    if (!candidates.length || remaining <= 0) return [];
    const ranked = candidates.map((sp) => ({ sp, available: speciesStock.get(sp) ?? 0 })).filter((x) => x.available > 0).sort((a, b) => b.available - a.available);
    const out = [];
    for (const { sp, available } of ranked) {
      if (remaining <= 0) break;
      const take = Math.min(available, remaining);
      if (take > 0) {
        out.push({ species: sp, qty: take });
        remaining -= take;
      }
    }
    return out;
  }
  var _seedDeleteAbort = null;
  var _seedDeleteBusy = false;
  var _seedDeletePaused = false;
  var _seedDeletePauseResolver = null;
  var DEFAULT_SEED_DELETE_DELAY_MS = 35;
  async function waitSeedPause() {
    while (_seedDeletePaused) {
      await new Promise((resolve) => {
        _seedDeletePauseResolver = resolve;
      });
      _seedDeletePauseResolver = null;
    }
  }
  async function deleteSelectedSeeds(opts = {}) {
    if (_seedDeleteBusy) {
      await toastSimple("Seed deleter", "Deletion already in progress.", "info");
      return;
    }
    const delayMs = Math.max(0, Math.floor(opts.delayMs ?? DEFAULT_SEED_DELETE_DELAY_MS));
    const selection = (opts.selection && Array.isArray(opts.selection) ? opts.selection : Array.from(selectedMap.values())).map((s) => ({ name: s.name, qty: Math.max(0, Math.floor(s.qty || 0)) })).filter((s) => s.qty > 0);
    if (selection.length === 0) {
      await toastSimple("Seed deleter", "No seeds selected.", "info");
      return;
    }
    const nameToSpecies = buildDisplayNameToSpeciesFromCatalog();
    const speciesStock = await buildSpeciesStockFromInventory();
    for (const species of speciesStock.keys()) {
      const dispName = seedDisplayNameFromSpecies(species);
      const arr = nameToSpecies.get(dispName) ?? [];
      if (!arr.includes(species)) arr.push(species);
      nameToSpecies.set(dispName, arr);
    }
    console.debug("[SeedDeleter] selection", selection);
    console.debug("[SeedDeleter] speciesStock", Object.fromEntries(speciesStock));
    const allocatedBySpecies = /* @__PURE__ */ new Map();
    let requestedTotal = 0, cappedTotal = 0;
    for (const req of selection) {
      requestedTotal += req.qty;
      const candidates = nameToSpecies.get(req.name) ?? [];
      const chunks = allocateForRequestedName(req, nameToSpecies, speciesStock);
      console.debug("[SeedDeleter] allocate", { name: req.name, qty: req.qty, candidates, chunks });
      const okForThis = chunks.reduce((a, c) => a + c.qty, 0);
      cappedTotal += okForThis;
      for (const c of chunks) {
        allocatedBySpecies.set(c.species, (allocatedBySpecies.get(c.species) ?? 0) + c.qty);
      }
    }
    if (cappedTotal <= 0) {
      await toastSimple("Seed deleter", "Nothing to delete (not in inventory).", "info");
      return;
    }
    if (cappedTotal < requestedTotal) {
      await toastSimple(
        "Seed deleter",
        `Requested ${formatNum(requestedTotal)} but only ${formatNum(cappedTotal)} available. Proceeding.`,
        "info"
      );
    }
    const tasks = Array.from(allocatedBySpecies.entries()).map(([species, qty]) => ({ species, qty: Math.max(0, Math.floor(qty || 0)) })).filter((t) => t.qty > 0);
    const total = tasks.reduce((acc, t) => acc + t.qty, 0);
    if (total <= 0) {
      await toastSimple("Seed deleter", "Nothing to delete.", "info");
      return;
    }
    _seedDeleteBusy = true;
    const abort = new AbortController();
    _seedDeleteAbort = abort;
    let doneDetail = null;
    let errorMsg = null;
    try {
      await toastSimple("Seed deleter", `Deleting ${formatNum(total)} seeds across ${tasks.length} species...`, "info");
      let done = 0;
      let successfulDeletes = 0;
      for (const t of tasks) {
        let remaining = t.qty;
        while (remaining > 0) {
          if (abort.signal.aborted) throw new Error("Deletion cancelled.");
          await waitSeedPause();
          let attemptSucceeded = false;
          try {
            await wish(t.species);
            attemptSucceeded = true;
          } catch {
          }
          if (attemptSucceeded) successfulDeletes += 1;
          done += 1;
          remaining -= 1;
          try {
            opts.onProgress?.({ done, total, species: t.species, remainingForSpecies: remaining });
            window.dispatchEvent(new CustomEvent("qws:seeddeleter:progress", {
              detail: { done, total, species: t.species, remainingForSpecies: remaining }
            }));
          } catch {
          }
          if (delayMs > 0 && remaining > 0) await sleep(delayMs);
        }
      }
      if (!opts.keepSelection) selectedMap.clear();
      if (successfulDeletes > 0) {
        await toastSimple("Seed deleter", `Deleted ${formatNum(successfulDeletes)} seeds (${tasks.length} species).`, "success");
      } else {
        await toastSimple("Seed deleter", "No seeds were deleted (requests failed).", "info");
      }
      doneDetail = { total, speciesCount: tasks.length };
    } catch (e) {
      const msg = e?.message || "Deletion failed.";
      errorMsg = msg;
      await toastSimple("Seed deleter", msg, "error");
    } finally {
      _seedDeleteBusy = false;
      _seedDeletePaused = false;
      _seedDeleteAbort = null;
      _seedDeletePauseResolver?.();
      _seedDeletePauseResolver = null;
      if (errorMsg !== null) {
        try {
          window.dispatchEvent(new CustomEvent("qws:seeddeleter:error", { detail: { message: errorMsg } }));
        } catch {
        }
      } else if (doneDetail) {
        try {
          window.dispatchEvent(new CustomEvent("qws:seeddeleter:done", { detail: doneDetail }));
        } catch {
        }
      }
    }
  }
  function cancelSeedDeletion() {
    try {
      _seedDeletePaused = false;
      _seedDeletePauseResolver?.();
      _seedDeletePauseResolver = null;
      _seedDeleteAbort?.abort();
    } catch {
    }
  }
  function isSeedDeletionRunning() {
    return _seedDeleteBusy;
  }
  function pauseSeedDeletion() {
    if (!_seedDeleteBusy || _seedDeletePaused) return;
    _seedDeletePaused = true;
    try {
      window.dispatchEvent(new CustomEvent("qws:seeddeleter:paused"));
    } catch {
    }
  }
  function resumeSeedDeletion() {
    if (!_seedDeletePaused) return;
    _seedDeletePaused = false;
    _seedDeletePauseResolver?.();
    _seedDeletePauseResolver = null;
    try {
      window.dispatchEvent(new CustomEvent("qws:seeddeleter:resumed"));
    } catch {
    }
  }
  function isSeedDeletionPaused() {
    return _seedDeletePaused;
  }
  try {
    window.addEventListener("qws:seeddeleter:apply", async (e) => {
      try {
        const selection = Array.isArray(e?.detail?.selection) ? e.detail.selection : void 0;
        await deleteSelectedSeeds({ selection, delayMs: DEFAULT_SEED_DELETE_DELAY_MS, keepSelection: false });
      } catch {
      }
    });
  } catch {
  }
  var selectedMap = /* @__PURE__ */ new Map();
  var seedStockByName = /* @__PURE__ */ new Map();
  var seedSourceCache = [];
  async function clearUiSelectionAtoms() {
    try {
      await Atoms.inventory.mySelectedItemName.set(null);
    } catch {
    }
    try {
      await Atoms.inventory.mySelectedItemId.set(null);
    } catch {
    }
    try {
      await Atoms.inventory.myValidatedSelectedItemIndex.set(null);
    } catch {
    }
    try {
      await Atoms.inventory.myPossiblyNoLongerValidSelectedItemIndex.set(null);
    } catch {
    }
  }
  var OVERLAY_ID = "qws-seeddeleter-overlay";
  var LIST_ID = "qws-seeddeleter-list";
  var SUMMARY_ID = "qws-seeddeleter-summary";
  function setStyles2(el, styles) {
    Object.assign(el.style, styles);
  }
  function styleOverlayBox(div, id) {
    div.id = id;
    setStyles2(div, {
      position: "fixed",
      left: "12px",
      top: "12px",
      zIndex: "999999",
      display: "grid",
      gridTemplateRows: "auto auto 1px 1fr auto",
      gap: "6px",
      minWidth: "320px",
      maxWidth: "420px",
      maxHeight: "52vh",
      padding: "8px",
      border: "1px solid #39424c",
      borderRadius: "10px",
      background: "rgba(22,27,34,0.92)",
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      backdropFilter: "blur(2px)",
      userSelect: "none",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: "12px",
      lineHeight: "1.25"
    });
  }
  function makeDraggable2(root, handle) {
    let dragging = false;
    let ox = 0, oy = 0;
    const onDown = (e) => {
      dragging = true;
      const r = root.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp, { once: true });
    };
    const onMove = (e) => {
      if (!dragging) return;
      const nx = Math.max(4, e.clientX - ox);
      const ny = Math.max(4, e.clientY - oy);
      root.style.left = `${nx}px`;
      root.style.top = `${ny}px`;
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener("mousemove", onMove);
    };
    handle.addEventListener("mousedown", onDown);
  }
  var BTN_STYLE_ID = "qws-seeddeleter-btn-style";
  var BTN_CLASS = "qws-sd-btn";
  function ensureButtonStylesInjected() {
    if (document.getElementById(BTN_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = BTN_STYLE_ID;
    style.textContent = `
    .${BTN_CLASS} { cursor: pointer; transition: filter 100ms ease, border-color 100ms ease, transform 80ms ease, opacity 100ms ease; }
    .${BTN_CLASS}:hover:not(:disabled) { filter: brightness(1.25); border-color: #8ac6ff; transform: translateY(-1px); }
    .${BTN_CLASS}:active:not(:disabled) { filter: brightness(0.9); transform: translateY(0); }
    .${BTN_CLASS}:disabled { opacity: 0.4; cursor: not-allowed; filter: grayscale(0.4); }
  `;
    document.head.appendChild(style);
  }
  function createButton(label, styleOverride) {
    ensureButtonStylesInjected();
    const b = document.createElement("button");
    b.textContent = label;
    b.classList.add(BTN_CLASS);
    setStyles2(b, {
      padding: "4px 8px",
      borderRadius: "8px",
      border: "1px solid #4446",
      background: "#161b22",
      color: "#E7EEF7",
      fontWeight: "600",
      fontSize: "12px",
      ...styleOverride
    });
    return b;
  }
  var overlayKeyGuardsOn = false;
  function isInsideOverlay(el) {
    return !!(el && el.closest?.(`#${OVERLAY_ID}`));
  }
  function keyGuardCapture(e) {
    const ae = document.activeElement;
    if (!isInsideOverlay(ae)) return;
    const tag = (ae?.tagName || "").toLowerCase();
    const isEditable = tag === "input" || tag === "textarea" || ae && ae.isContentEditable;
    if (!isEditable) return;
    if (/^[0-9]$/.test(e.key)) {
      e.stopImmediatePropagation();
    }
  }
  function installOverlayKeyGuards() {
    if (overlayKeyGuardsOn) return;
    window.addEventListener("keydown", keyGuardCapture, { capture: true });
    overlayKeyGuardsOn = true;
  }
  function removeOverlayKeyGuards() {
    if (!overlayKeyGuardsOn) return;
    window.removeEventListener("keydown", keyGuardCapture, { capture: true });
    overlayKeyGuardsOn = false;
  }
  async function closeSeedInventoryPanel() {
    try {
      await fakeInventoryHide();
    } catch {
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      } catch {
      }
    }
  }
  var _btnConfirm = null;
  function createSeedOverlay() {
    const box = document.createElement("div");
    styleOverlayBox(box, OVERLAY_ID);
    const header = document.createElement("div");
    setStyles2(header, { display: "flex", alignItems: "center", gap: "4px", cursor: "move" });
    const title = document.createElement("div");
    title.textContent = "\u{1F3AF} Selection mode";
    setStyles2(title, { fontWeight: "700", fontSize: "13px" });
    const hint = document.createElement("div");
    hint.textContent = "Click seeds in inventory to toggle selection.";
    setStyles2(hint, { opacity: "0.8", fontSize: "11px" });
    const hr = document.createElement("div");
    setStyles2(hr, { height: "1px", background: "#2d333b" });
    const list = document.createElement("div");
    list.id = LIST_ID;
    setStyles2(list, {
      minHeight: "44px",
      maxHeight: "26vh",
      overflow: "auto",
      padding: "4px",
      border: "1px dashed #39424c",
      borderRadius: "8px",
      background: "rgba(15,19,24,0.84)",
      userSelect: "text"
    });
    const actions = document.createElement("div");
    setStyles2(actions, { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" });
    const summary = document.createElement("div");
    summary.id = SUMMARY_ID;
    setStyles2(summary, { fontWeight: "600" });
    summary.textContent = "Selected: 0 species \xB7 0 seeds";
    const btnClear = createButton("Clear");
    btnClear.title = "Clear selection";
    btnClear.onclick = async () => {
      selectedMap.clear();
      refreshList();
      updateSummary();
      await clearUiSelectionAtoms();
      await repatchFakeSeedInventoryWithSelection();
    };
    _btnConfirm = createButton("Confirm", { background: "#1F2328CC" });
    _btnConfirm.disabled = true;
    _btnConfirm.onclick = async () => {
      await closeSeedInventoryPanel();
    };
    header.append(title);
    actions.append(summary, btnClear, _btnConfirm);
    box.append(header, hint, hr, list, actions);
    makeDraggable2(box, header);
    return box;
  }
  function centerOverlay(el) {
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, (window.innerWidth - r.width) / 2)}px`;
    el.style.top = `${Math.max(4, (window.innerHeight - r.height) / 2)}px`;
  }
  function showSeedOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    const el = createSeedOverlay();
    document.body.appendChild(el);
    centerOverlay(el);
    installOverlayKeyGuards();
    refreshList();
    updateSummary();
  }
  function hideSeedOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    removeOverlayKeyGuards();
  }
  function isSelectionOverlayOpen() {
    return !!document.getElementById(OVERLAY_ID);
  }
  function renderListRow(item) {
    const row = document.createElement("div");
    setStyles2(row, {
      display: "grid",
      gridTemplateColumns: "1fr auto",
      alignItems: "center",
      gap: "6px",
      padding: "4px 6px",
      borderBottom: "1px dashed #2d333b"
    });
    const name = document.createElement("div");
    name.textContent = item.name;
    setStyles2(name, {
      fontSize: "12px",
      fontWeight: "600",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    });
    const controls = document.createElement("div");
    setStyles2(controls, { display: "flex", alignItems: "center", gap: "6px" });
    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "1";
    qty.max = String(Math.max(1, item.maxQty));
    qty.step = "1";
    qty.value = String(item.qty);
    setStyles2(qty, {
      width: "68px",
      height: "28px",
      border: "1px solid #4446",
      borderRadius: "8px",
      background: "rgba(15,19,24,0.90)",
      padding: "0 8px",
      fontSize: "12px"
    });
    const swallowDigits = (e) => {
      if (/^[0-9]$/.test(e.key)) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    qty.addEventListener("keydown", swallowDigits);
    const updateQty = async () => {
      const v = Math.min(item.maxQty, Math.max(1, Math.floor(Number(qty.value) || 1)));
      qty.value = String(v);
      const cur = selectedMap.get(item.name);
      if (!cur) return;
      cur.qty = v;
      selectedMap.set(item.name, cur);
      updateSummary();
      await repatchFakeSeedInventoryWithSelection();
    };
    qty.onchange = () => {
      void updateQty();
    };
    qty.oninput = () => {
      void updateQty();
    };
    const remove = createButton("Remove", { background: "transparent" });
    remove.onclick = async () => {
      selectedMap.delete(item.name);
      refreshList();
      updateSummary();
      await repatchFakeSeedInventoryWithSelection();
    };
    controls.append(qty, remove);
    row.append(name, controls);
    return row;
  }
  function refreshList() {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    list.innerHTML = "";
    const entries = Array.from(selectedMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No seeds selected.";
      empty.style.opacity = "0.8";
      list.appendChild(empty);
      return;
    }
    for (const it of entries) list.appendChild(renderListRow(it));
  }
  function totalSelected() {
    let species = 0, qty = 0;
    for (const it of selectedMap.values()) {
      species += 1;
      qty += it.qty;
    }
    return { species, qty };
  }
  function updateSummary() {
    const { species, qty } = totalSelected();
    const el = document.getElementById(SUMMARY_ID);
    if (el) el.textContent = `Selected: ${species} species \xB7 ${formatNum(qty)} seeds`;
    if (_btnConfirm) {
      _btnConfirm.textContent = "Confirm";
      _btnConfirm.disabled = qty <= 0;
      _btnConfirm.style.opacity = qty <= 0 ? "0.6" : "1";
      _btnConfirm.style.cursor = qty <= 0 ? "not-allowed" : "pointer";
    }
  }
  async function repatchFakeSeedInventoryWithSelection() {
    const src = Array.isArray(seedSourceCache) ? seedSourceCache : [];
    const remainingByName = /* @__PURE__ */ new Map();
    for (const s of src) {
      const disp = seedDisplayNameFromSpecies(s.species);
      const qty = Math.max(0, Math.floor(s.quantity || 0));
      remainingByName.set(disp, (remainingByName.get(disp) ?? 0) + qty);
    }
    for (const sel of selectedMap.values()) {
      const cur = remainingByName.get(sel.name) ?? 0;
      const picked = Math.max(0, Math.floor(sel.qty || 0));
      remainingByName.set(sel.name, Math.max(0, cur - picked));
    }
    const patched = [];
    for (const s of src) {
      const disp = seedDisplayNameFromSpecies(s.species);
      const remaining = remainingByName.get(disp) ?? 0;
      if (remaining <= 0) continue;
      const take = Math.min(remaining, Math.max(0, Math.floor(s.quantity || 0)));
      if (take <= 0) continue;
      patched.push({ ...s, quantity: take });
      remainingByName.set(disp, remaining - take);
    }
    try {
      await fakeInventoryShow({ items: patched, favoritedItemIds: [] }, { open: false });
    } catch {
    }
  }
  var unsubSelectedName = null;
  async function beginSelectedNameListener() {
    if (unsubSelectedName) return;
    const unsub = await Atoms.inventory.mySelectedItemName.onChange(async (name) => {
      const n = (name || "").trim();
      if (!n) return;
      const max = Math.max(1, seedStockByName.get(n) ?? 1);
      const existing = selectedMap.get(n);
      if (existing) {
        existing.qty = max;
        existing.maxQty = max;
        selectedMap.set(n, existing);
      } else {
        selectedMap.set(n, { name: n, qty: max, maxQty: max });
      }
      refreshList();
      updateSummary();
      await clearUiSelectionAtoms();
      await repatchFakeSeedInventoryWithSelection();
    });
    unsubSelectedName = typeof unsub === "function" ? unsub : null;
  }
  async function endSelectedNameListener() {
    const fn = unsubSelectedName;
    unsubSelectedName = null;
    try {
      await fn?.();
    } catch {
    }
  }
  async function openSeedSelectorFlow(setWindowVisible) {
    try {
      setWindowVisible?.(false);
      seedSourceCache = await getMySeedInventory();
      seedStockByName = /* @__PURE__ */ new Map();
      for (const s of seedSourceCache) {
        const display = seedDisplayNameFromSpecies(s.species);
        seedStockByName.set(display, Math.max(1, Math.floor(s.quantity || 0)));
      }
      selectedMap.clear();
      showSeedOverlay();
      await beginSelectedNameListener();
      await fakeInventoryShow(buildInventoryShapeFrom(seedSourceCache), { open: true });
      if (await isInventoryPanelOpen()) {
        await waitInventoryPanelClosed();
      }
    } catch (e) {
      await toastSimple("Seed inventory", e?.message || "Failed to open seed selector.", "error");
    } finally {
      await endSelectedNameListener();
      hideSeedOverlay();
      seedSourceCache = [];
      seedStockByName.clear();
      setWindowVisible?.(true);
    }
  }
  var SeedDeleterService = {
    getMySeedInventory,
    openSeedSelectorFlow,
    deleteSelectedSeeds,
    cancelSeedDeletion,
    isSeedDeletionRunning,
    pauseSeedDeletion,
    resumeSeedDeletion,
    isSeedDeletionPaused,
    getCurrentSeedSelection() {
      return Array.from(selectedMap.values());
    },
    clearSeedSelection() {
      selectedMap.clear();
    }
  };

  // src/ui/panel/panelRows.ts
  function createHint(hint) {
    if (!hint) return null;
    const el = document.createElement("div");
    el.textContent = hint;
    setStyles(el, { fontSize: "11px", fontWeight: "400", opacity: "0.6", marginTop: "2px" });
    return el;
  }
  function createRow(label, control, hint) {
    const row = setStyles(document.createElement("div"), {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      alignItems: "center",
      gap: "10px",
      padding: "8px 10px",
      border: "1px solid #2b3340",
      borderRadius: "8px",
      background: "#0f1318"
    });
    const textCol = document.createElement("div");
    const text = document.createElement("div");
    text.textContent = label;
    setStyles(text, { fontSize: "12px", fontWeight: "600", opacity: "0.85" });
    textCol.appendChild(text);
    const hintEl = createHint(hint);
    if (hintEl) textCol.appendChild(hintEl);
    const controls = setStyles(document.createElement("div"), {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      flexWrap: "wrap",
      justifyContent: "flex-end"
    });
    controls.appendChild(control);
    row.append(textCol, controls);
    return row;
  }
  function createVerticalRow(label, control, hint, opts) {
    const stretch = !!opts?.stretch;
    const row = setStyles(document.createElement("div"), {
      display: "flex",
      alignItems: stretch ? "stretch" : "center",
      flexDirection: "column",
      gap: "5px",
      padding: "8px 10px",
      border: "1px solid #2b3340",
      borderRadius: "8px",
      background: "#0f1318"
    });
    const text = document.createElement("div");
    text.textContent = label;
    setStyles(text, { fontSize: "12px", fontWeight: "600", opacity: "0.85", display: "flex", justifyContent: "center" });
    row.appendChild(text);
    const hintEl = createHint(hint);
    if (hintEl) {
      setStyles(hintEl, { marginTop: "-3px", textAlign: "center" });
      row.appendChild(hintEl);
    }
    const controls = setStyles(document.createElement("div"), {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      flexWrap: "wrap",
      justifyContent: stretch ? "stretch" : "flex-end",
      ...stretch ? { width: "100%" } : {}
    });
    controls.appendChild(control);
    row.append(controls);
    return row;
  }
  function createSectionTitle(label) {
    const el = document.createElement("div");
    el.textContent = label;
    setStyles(el, {
      fontSize: "10px",
      fontWeight: "700",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      opacity: "0.5",
      margin: "4px 2px -2px"
    });
    return el;
  }

  // src/ui/panel/hotkey.ts
  var OPEN_HOTKEY_STORAGE_KEY = "mgSeedDeleter.openHotkey.v1";
  var DEFAULT_OPEN_HOTKEY = "Delete";
  var MODIFIER_KEYS = /* @__PURE__ */ new Set(["Shift", "Control", "Alt", "Meta"]);
  var KEY_LABELS = {
    Delete: "Del / Canc",
    Backspace: "Backspace",
    Escape: "Esc",
    " ": "Space",
    ArrowUp: "\u2191",
    ArrowDown: "\u2193",
    ArrowLeft: "\u2190",
    ArrowRight: "\u2192"
  };
  function labelForKey(key) {
    return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  }
  function loadOpenHotkey() {
    try {
      const stored = localStorage.getItem(OPEN_HOTKEY_STORAGE_KEY);
      if (stored) return stored;
    } catch {
    }
    return DEFAULT_OPEN_HOTKEY;
  }
  function saveOpenHotkey(key) {
    try {
      localStorage.setItem(OPEN_HOTKEY_STORAGE_KEY, key);
    } catch {
    }
  }
  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
  }
  function installOpenHotkeyListener(onTrigger) {
    const handler = (e) => {
      if (isEditableTarget(document.activeElement)) return;
      if (e.key !== loadOpenHotkey()) return;
      e.preventDefault();
      onTrigger();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }
  function createHotkeyPicker() {
    const btn = createButton(labelForKey(loadOpenHotkey()), { minWidth: "84px" });
    btn.title = "Click, then press the key you want to use.";
    let removeCapture = null;
    const stopCapturing = () => {
      removeCapture?.();
      removeCapture = null;
      btn.textContent = labelForKey(loadOpenHotkey());
    };
    btn.onclick = () => {
      if (removeCapture) return;
      btn.textContent = "Press a key\u2026";
      const onKeyDown = (e) => {
        if (MODIFIER_KEYS.has(e.key)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === "Escape") {
          stopCapturing();
          return;
        }
        saveOpenHotkey(e.key);
        stopCapturing();
      };
      window.addEventListener("keydown", onKeyDown, { capture: true });
      removeCapture = () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
    return btn;
  }

  // src/ui/panel/seedPanel.ts
  var PANEL_ID = "qws-seeddeleter-panel";
  var PANEL_POSITION_KEY = "mgSeedDeleter.panelPosition.v1";
  var DELETE_CONFIRM_TIMEOUT_MS = 3e3;
  var COLOR_IDLE = "#2b3340";
  var COLOR_RUNNING = "#1f6feb";
  var COLOR_PAUSED = "#d29922";
  function createPanel(toggleMode) {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    setStyles(panel, {
      position: "fixed",
      right: "16px",
      bottom: "62px",
      zIndex: "999998",
      display: "none",
      flexDirection: "column",
      gap: "8px",
      minWidth: "320px",
      maxWidth: "380px",
      padding: "10px",
      border: "1px solid #39424c",
      borderRadius: "12px",
      background: "rgba(22,27,34,0.96)",
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      backdropFilter: "blur(2px)",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: "12px",
      color: "#E7EEF7"
    });
    const header = setStyles(document.createElement("div"), {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    });
    const titleCol = document.createElement("div");
    const title = document.createElement("div");
    title.textContent = "\u{1F331} Seed deleter";
    setStyles(title, { fontWeight: "700", fontSize: "13px" });
    const subtitle = document.createElement("div");
    subtitle.textContent = "Pick seeds from your inventory and delete them in bulk.";
    setStyles(subtitle, { fontSize: "11px", opacity: "0.6", marginTop: "2px" });
    titleCol.append(title, subtitle);
    const btnClose = createButton("\xD7", {
      padding: "0 6px",
      lineHeight: "18px",
      fontSize: "14px",
      background: "transparent",
      border: "1px solid transparent"
    });
    btnClose.title = "Close";
    btnClose.setAttribute("aria-label", "Close panel");
    header.append(titleCol, btnClose);
    const summaryPill = setStyles(document.createElement("div"), {
      padding: "3px 8px",
      borderRadius: "999px",
      border: "1px solid #2b3340",
      background: "#141b22",
      fontSize: "11px",
      fontWeight: "600",
      color: "#dbe7ff"
    });
    summaryPill.textContent = "No seeds selected yet";
    const summaryRow = createVerticalRow("Selection", summaryPill, "What's queued up for deletion right now.");
    const selectionActions = setStyles(document.createElement("div"), { display: "flex", gap: "6px", flexWrap: "wrap" });
    const btnSelect = createButton("Select seeds", { background: "#1f6feb", borderColor: "#1f6feb" });
    const btnClear = createButton("Clear selection");
    selectionActions.append(btnSelect, btnClear);
    const selectionActionsRow = createVerticalRow("Pick seeds", selectionActions, "Opens your inventory so you can choose which seeds to delete.");
    const progressTrack = setStyles(document.createElement("div"), {
      width: "100%",
      height: "6px",
      borderRadius: "999px",
      background: "#0a0d11",
      overflow: "hidden"
    });
    const progressFill = setStyles(document.createElement("div"), {
      height: "100%",
      width: "0%",
      borderRadius: "999px",
      background: COLOR_IDLE,
      transition: "width 120ms linear, background 150ms linear"
    });
    progressTrack.appendChild(progressFill);
    const statusLine = setStyles(document.createElement("div"), {
      fontSize: "11px",
      fontWeight: "600",
      opacity: "0.85"
    });
    statusLine.textContent = "Idle - nothing is being deleted.";
    const progressCol = setStyles(document.createElement("div"), {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      width: "100%"
    });
    progressCol.append(statusLine, progressTrack);
    const progressRow = createVerticalRow("Progress", progressCol, "Live status of the current deletion.", { stretch: true });
    const runControls = setStyles(document.createElement("div"), { display: "flex", gap: "6px", flexWrap: "wrap" });
    const btnDelete = createButton("Delete selected", { background: "#a1260d", borderColor: "#a1260d" });
    const btnPause = createButton("Pause");
    const btnPlay = createButton("Play");
    const btnStop = createButton("Stop", { background: "transparent" });
    runControls.append(btnDelete, btnPause, btnPlay, btnStop);
    const runControlsRow = createVerticalRow("Run", runControls, "Start the deletion, or pause/resume/stop it while it runs.");
    const modeCheckbox = document.createElement("input");
    modeCheckbox.type = "checkbox";
    modeCheckbox.checked = toggleMode.getMode() === "fixed";
    setStyles(modeCheckbox, { width: "16px", height: "16px", cursor: "pointer" });
    modeCheckbox.onchange = () => toggleMode.setMode(modeCheckbox.checked ? "fixed" : "draggable");
    const modeRow = createRow("Lock \u{1F331} button", modeCheckbox, "When unchecked, you can drag the button anywhere on screen.");
    const hotkeyPicker = createHotkeyPicker();
    const hotkeyRow = createRow("Open panel shortcut", hotkeyPicker, "Press this key anywhere (Esc closes the panel) to open/close it.");
    const GITHUB_URL = "https://github.com/joshueke/MG-SeedDeleterMod";
    const versionLabel = setStyles(document.createElement("div"), {
      fontSize: "12px",
      fontWeight: "600",
      opacity: "0.85",
      cursor: "pointer",
      textDecoration: "underline"
    });
    versionLabel.textContent = `v${"0.0.9"}`;
    versionLabel.title = "Open project on GitHub";
    versionLabel.onclick = () => window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
    const versionRow = createRow("Version", versionLabel, "Current version of the Seed Deleter userscript. Click to open the GitHub repo.");
    panel.append(
      header,
      createSectionTitle("Selection"),
      summaryRow,
      selectionActionsRow,
      createSectionTitle("Deletion"),
      runControlsRow,
      progressRow,
      createSectionTitle("Settings"),
      modeRow,
      hotkeyRow,
      createSectionTitle("Info"),
      versionRow
    );
    makeDraggable(panel, header, PANEL_POSITION_KEY);
    const setVisible = (v) => {
      panel.style.display = v ? "flex" : "none";
      if (v) restoreSavedPosition(panel, PANEL_POSITION_KEY);
    };
    btnClose.onclick = () => setVisible(false);
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (panel.style.display === "none") return;
      setVisible(false);
    });
    const seedStatus = { species: "-", done: 0, total: 0, remaining: 0 };
    let estimatedFinish = null;
    const describeStatus = () => {
      const running = SeedDeleterService.isSeedDeletionRunning();
      const paused = SeedDeleterService.isSeedDeletionPaused();
      if (!running) return "Idle - nothing is being deleted.";
      const base = `${seedStatus.species || "-"} (${seedStatus.done}/${seedStatus.total})`;
      if (paused) return `Paused - ${base}`;
      const eta = estimatedFinish ? ` \xB7 ETA ${formatFinishTime(estimatedFinish)}` : "";
      return `Deleting ${base}${eta}`;
    };
    const updateProgressBar = () => {
      const running = SeedDeleterService.isSeedDeletionRunning();
      const paused = SeedDeleterService.isSeedDeletionPaused();
      const pct = seedStatus.total > 0 ? Math.min(100, Math.round(seedStatus.done / seedStatus.total * 100)) : 0;
      progressFill.style.width = `${running ? pct : 0}%`;
      progressFill.style.background = !running ? COLOR_IDLE : paused ? COLOR_PAUSED : COLOR_RUNNING;
    };
    const updateStatusUI = () => {
      statusLine.textContent = describeStatus();
      updateProgressBar();
    };
    const updateControlState = () => {
      const running = SeedDeleterService.isSeedDeletionRunning();
      const paused = SeedDeleterService.isSeedDeletionPaused();
      btnPause.disabled = !running || paused;
      btnPlay.disabled = !running || !paused;
      btnStop.disabled = !running;
      btnSelect.disabled = running;
      updateStatusUI();
    };
    let summaryTimer = null;
    const clearSummaryTimer = () => {
      if (summaryTimer !== null) {
        clearTimeout(summaryTimer);
        summaryTimer = null;
      }
    };
    const scheduleSummaryRefresh = () => {
      clearSummaryTimer();
      summaryTimer = window.setTimeout(() => updateSummaryUI(), 1e3);
    };
    function readSelection() {
      const sel = SeedDeleterService.getCurrentSeedSelection() || [];
      let totalQty = 0;
      for (const it of sel) totalQty += Math.max(0, Math.floor(it?.qty || 0));
      return { speciesCount: sel.length, totalQty };
    }
    let deleteArmed = false;
    let deleteArmTimer = null;
    const defaultDeleteLabel = (totalQty) => totalQty > 0 ? `Delete ${formatNum(totalQty)} seeds` : "Delete selected";
    const resetDeleteArm = () => {
      deleteArmed = false;
      if (deleteArmTimer !== null) {
        clearTimeout(deleteArmTimer);
        deleteArmTimer = null;
      }
      setStyles(btnDelete, { background: "#a1260d", borderColor: "#a1260d" });
      const { totalQty } = readSelection();
      btnDelete.textContent = defaultDeleteLabel(totalQty);
    };
    function updateSummaryUI() {
      const { speciesCount, totalQty } = readSelection();
      const isRunning = SeedDeleterService.isSeedDeletionRunning();
      if (speciesCount <= 0 || totalQty <= 0) {
        summaryPill.textContent = "No seeds selected yet";
      } else {
        const estimateMs = totalQty * (DEFAULT_SEED_DELETE_DELAY_MS + EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS);
        const estimateText = estimateMs > 0 ? ` \xB7 ~${formatDurationShort(estimateMs)} to delete` : "";
        summaryPill.textContent = `${speciesCount} species, ${formatNum(totalQty)} seeds selected${estimateText}`;
      }
      const has = speciesCount > 0 && totalQty > 0;
      btnDelete.disabled = !has || isRunning;
      btnClear.disabled = !has;
      if (!deleteArmed) btnDelete.textContent = defaultDeleteLabel(totalQty);
      if (!isRunning && totalQty > 0) scheduleSummaryRefresh();
      else clearSummaryTimer();
    }
    const onProgress = (event) => {
      const detail = event.detail;
      seedStatus.species = detail.species;
      seedStatus.done = detail.done;
      seedStatus.total = detail.total;
      seedStatus.remaining = detail.remainingForSpecies;
      updateStatusUI();
      updateControlState();
    };
    const onComplete = () => {
      seedStatus.species = "-";
      seedStatus.done = 0;
      seedStatus.total = 0;
      seedStatus.remaining = 0;
      estimatedFinish = null;
      updateStatusUI();
      updateControlState();
      updateSummaryUI();
    };
    const onPaused = () => updateControlState();
    const onResumed = () => updateControlState();
    window.addEventListener("qws:seeddeleter:progress", onProgress);
    window.addEventListener("qws:seeddeleter:done", onComplete);
    window.addEventListener("qws:seeddeleter:error", onComplete);
    window.addEventListener("qws:seeddeleter:paused", onPaused);
    window.addEventListener("qws:seeddeleter:resumed", onResumed);
    btnPause.onclick = () => {
      SeedDeleterService.pauseSeedDeletion();
      updateControlState();
    };
    btnPlay.onclick = () => {
      SeedDeleterService.resumeSeedDeletion();
      updateControlState();
    };
    btnStop.onclick = () => {
      SeedDeleterService.cancelSeedDeletion();
      updateControlState();
    };
    btnSelect.onclick = async () => {
      await SeedDeleterService.openSeedSelectorFlow(setVisible);
      resetDeleteArm();
      updateSummaryUI();
    };
    btnClear.onclick = () => {
      SeedDeleterService.clearSeedSelection();
      resetDeleteArm();
      updateSummaryUI();
    };
    btnDelete.onclick = async () => {
      if (!deleteArmed) {
        deleteArmed = true;
        btnDelete.textContent = "Click again to confirm";
        setStyles(btnDelete, { background: "#da3633", borderColor: "#da3633" });
        deleteArmTimer = window.setTimeout(resetDeleteArm, DELETE_CONFIRM_TIMEOUT_MS);
        return;
      }
      const { totalQty } = readSelection();
      const estimateMs = totalQty * (DEFAULT_SEED_DELETE_DELAY_MS + EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS);
      estimatedFinish = estimateMs > 0 ? Date.now() + estimateMs : null;
      clearSummaryTimer();
      resetDeleteArm();
      updateControlState();
      const deletionPromise = SeedDeleterService.deleteSelectedSeeds({ delayMs: DEFAULT_SEED_DELETE_DELAY_MS });
      updateSummaryUI();
      await deletionPromise;
      estimatedFinish = null;
      updateSummaryUI();
    };
    updateStatusUI();
    updateControlState();
    updateSummaryUI();
    return { panel, setVisible };
  }

  // src/ui/panel/index.ts
  function mountNow() {
    if (document.getElementById(TOGGLE_ID)) return;
    let openToggle = () => {
    };
    const toggle = createToggleButton(() => openToggle());
    const { panel, setVisible } = createPanel({ setMode: toggle.setMode, getMode: toggle.getMode });
    openToggle = () => setVisible(panel.style.display === "none");
    installOpenHotkeyListener(() => {
      if (isSelectionOverlayOpen()) return;
      openToggle();
    });
    document.body.appendChild(toggle.btn);
    document.body.appendChild(panel);
  }
  function mountSeedDeleterUI() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountNow, { once: true });
    } else {
      mountNow();
    }
  }

  // src/main.ts
  (function() {
    "use strict";
    installPageWebSocketHook();
    mountSeedDeleterUI();
  })();
})();
