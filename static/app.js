const byId = (id) => document.getElementById(id);
const R = Math.PI / 180;
const STORAGE = "irregular-shapes-v2";
const copy = (v) => JSON.parse(JSON.stringify(v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const degrees = (a) => a / R;
const normalize = (a) => ((a + Math.PI) % (2 * Math.PI) + (2 * Math.PI)) % (2 * Math.PI) - Math.PI;

class AreaCalculator {
  constructor() {
    this.canvas = byId("canvas"); this.ctx = this.canvas.getContext("2d");
    this.state = { name: "Untitled", unit: "m", startDirection: 0, segments: [], diagonals: [], closed: false, orthogonal: false };
    this.view = { scale: 55, x: 0, y: 0 }; this.history = []; this.future = [];
    this.drawing = false; this.nextHeading = null; this.mouse = null; this.dragIndex = null; this.pan = null; this.space = false; this.diagonal = [];
    this.touchActive = false; this.touchStartPoint = null; this.touchMoved = false; this.touchPan = null; this.pinch = null; this.frame = null; this.resizeTimer = null; this.keypadIndex = null; this.keypadValue = ""; this.drawerDrag = null; this.suppressDrawerClick = false;
    this.loadLocal(); this.bind(); new ResizeObserver(() => this.scheduleResize()).observe(this.canvas.parentElement);
    window.addEventListener("resize", () => this.scheduleResize()); window.visualViewport?.addEventListener("resize", () => this.scheduleResize()); this.resize(); this.sync(); this.refreshProjects();
  }
  bind() {
    this.canvas.addEventListener("wheel", (e) => this.zoom(e), { passive: false });
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", () => this.up());
    this.canvas.addEventListener("touchstart", (e) => this.touchStart(e), { passive: false });
    this.canvas.addEventListener("touchmove", (e) => this.touchMove(e), { passive: false });
    this.canvas.addEventListener("touchend", (e) => this.touchEnd(e), { passive: false });
    this.canvas.addEventListener("touchcancel", (e) => this.touchEnd(e), { passive: false });
    document.addEventListener("keydown", (e) => this.keydown(e));
    document.addEventListener("keyup", (e) => { if (e.code === "Space") this.space = false; });
    byId("drawButton").addEventListener("click", () => { if (this.state.closed) return this.toast("Clear or reopen the shape before drawing.", "error"); this.drawing = !this.drawing; if (this.drawing) this.hideDrawer(); this.sync(); });
    byId("orthogonalButton").addEventListener("click", () => { this.state.orthogonal = !this.state.orthogonal; this.saveLocal(); this.sync(); });
    byId("fitButton").addEventListener("click", () => this.fit());
    byId("clearButton").addEventListener("click", () => this.confirmClear());
    byId("closeButton").addEventListener("click", () => this.close());
    byId("undoButton").addEventListener("click", () => this.undo());
    byId("redoButton").addEventListener("click", () => this.redo());
    byId("lengthInput").addEventListener("keydown", (e) => { if (e.key === "Enter") this.directLength(); });
    byId("angleInput").addEventListener("keydown", (e) => { if (e.key === "Enter") this.directTurn(); });
    ["projectName", "unitSelect", "startDir"].forEach((id) => byId(id).addEventListener("change", () => this.projectChanged()));
    byId("wallList").addEventListener("change", (e) => this.wallChanged(e));
    byId("addDiagonalButton").addEventListener("click", () => this.startDiagonal());
    byId("diagonalList").addEventListener("click", (e) => this.removeDiagonal(e));
    byId("saveButton").addEventListener("click", () => this.saveProject());
    byId("refreshButton").addEventListener("click", () => this.refreshProjects());
    byId("loadButton").addEventListener("click", () => this.loadProject());
    byId("deleteButton").addEventListener("click", () => this.deleteProject());
    byId("drawerButton").addEventListener("click", () => this.toggleDrawer());
    const drawerHandle = document.querySelector(".drawer-handle");
    drawerHandle.addEventListener("pointerdown", (e) => this.startDrawerDrag(e));
    drawerHandle.addEventListener("pointermove", (e) => this.moveDrawerDrag(e));
    drawerHandle.addEventListener("pointerup", (e) => this.endDrawerDrag(e));
    drawerHandle.addEventListener("pointercancel", (e) => this.endDrawerDrag(e));
    drawerHandle.addEventListener("click", () => {
      if (this.suppressDrawerClick) { this.suppressDrawerClick = false; return; }
      this.toggleDrawer();
    });
    byId("floatingKeypad").addEventListener("click", (e) => this.keypadPress(e));
  }
  resize() {
    const r = this.canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    this.width = r.width; this.height = r.height; this.canvas.width = Math.max(1, r.width * dpr); this.canvas.height = Math.max(1, r.height * dpr); this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.view.x) { this.view.x = r.width / 2; this.view.y = r.height / 2; } this.render();
  }
  scheduleResize() { clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => this.resize(), 90); }
  queueRender() { if (this.frame) return; this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); }); }
  saveState() { this.history.push(copy(this.state)); if (this.history.length > 80) this.history.shift(); this.future = []; }
  change(fn) { this.saveState(); fn(); this.saveLocal(); this.sync(); }
  undo() { if (!this.history.length) return; this.future.push(copy(this.state)); this.state = this.history.pop(); this.saveLocal(); this.sync(); }
  redo() { if (!this.future.length) return; this.history.push(copy(this.state)); this.state = this.future.pop(); this.saveLocal(); this.sync(); }
  loadLocal() { try { const saved = JSON.parse(localStorage.getItem(STORAGE)); if (saved && Array.isArray(saved.segments)) this.state = Object.assign(this.state, saved); } catch (_) {} }
  saveLocal() { try { localStorage.setItem(STORAGE, JSON.stringify(this.state)); } catch (_) { this.toast("Browser storage is unavailable.", "error"); } }
  points() { const result = [{ x: 0, y: 0 }]; this.state.segments.forEach((s) => { const p = result.at(-1); result.push({ x: p.x + s.length * Math.cos(s.angle), y: p.y + s.length * Math.sin(s.angle) }); }); return result; }
  screen(p) { return { x: p.x * this.view.scale + this.view.x, y: this.view.y - p.y * this.view.scale }; }
  world(p) { return { x: (p.x - this.view.x) / this.view.scale, y: (this.view.y - p.y) / this.view.scale }; }
  point(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  snap(a, enabled) { return enabled ? Math.round(a / (Math.PI / 2)) * Math.PI / 2 : a; }
  vertexAt(p) { const points = this.points(), radius = matchMedia("(max-width: 800px)").matches ? 28 : 13; for (let i = points.length - 1; i >= 0; i--) { const s = this.screen(points[i]); if (Math.hypot(s.x - p.x, s.y - p.y) < radius) return i; } return -1; }
  segmentAt(p) {
    const points = this.points(), radius = matchMedia("(max-width: 800px)").matches ? 28 : 12;
    for (let i = 0; i < this.state.segments.length; i++) {
      const a = this.screen(points[i]), b = this.screen(points[i + 1]), dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
      const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
      if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= radius) return i;
    }
    return -1;
  }
  down(e) {
    if (e.pointerType === "touch" || this.touchActive) return;
    this.canvas.setPointerCapture(e.pointerId); const p = this.point(e);
    if (e.button === 1 || this.space) { this.pan = { p, x: this.view.x, y: this.view.y }; return; }
    if (e.button !== 0) return; const hit = this.vertexAt(p);
    if (this.diagonal.length && hit >= 0) return this.pickDiagonal(hit);
    if (this.drawing) return this.place(p, e.shiftKey);
    if (hit > 0) { this.saveState(); this.dragIndex = hit; return; }
    const segment = this.segmentAt(p); if (segment >= 0) this.openKeypad(segment);
  }
  move(e) {
    if (e.pointerType === "touch" || this.touchActive) return;
    const p = this.point(e); this.mouse = p;
    if (this.pan) { this.view.x = this.pan.x + p.x - this.pan.p.x; this.view.y = this.pan.y + p.y - this.pan.p.y; return this.render(); }
    if (this.dragIndex) { this.dragVertex(this.dragIndex, this.world(p), e.shiftKey); this.saveLocal(); return this.sync(); }
    this.canvas.style.cursor = this.drawing ? "crosshair" : this.vertexAt(p) > 0 ? "grab" : "default"; this.render();
  }
  up() { if (this.dragIndex) { this.dragIndex = null; this.future = []; this.sync(); } this.pan = null; }
  touchPoints(touches) { return Array.from(touches, (touch) => { const r = this.canvas.getBoundingClientRect(); return { x: touch.clientX - r.left, y: touch.clientY - r.top }; }); }
  touchStart(e) {
    e.preventDefault(); this.touchActive = true; const points = this.touchPoints(e.touches);
    if (points.length === 1) { this.touchStartPoint = points[0]; this.touchMoved = false; this.touchPan = { point: points[0], x: this.view.x, y: this.view.y }; this.pinch = null; }
    if (points.length === 2) this.startPinch(points);
  }
  startPinch(points) {
    const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    this.pinch = { distance: Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)), world: this.world(mid) }; this.touchPan = null; this.touchMoved = true;
  }
  touchMove(e) {
    e.preventDefault(); const points = this.touchPoints(e.touches);
    if (points.length === 2) {
      if (!this.pinch) this.startPinch(points);
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      this.view.scale = Math.max(6, Math.min(900, this.view.scale * distance / this.pinch.distance)); this.view.x = mid.x - this.pinch.world.x * this.view.scale; this.view.y = mid.y + this.pinch.world.y * this.view.scale; this.pinch.distance = distance; this.queueRender(); return;
    }
    if (points.length === 1 && this.touchPan) {
      const p = points[0]; if (Math.hypot(p.x - this.touchStartPoint.x, p.y - this.touchStartPoint.y) > 8) this.touchMoved = true;
      this.view.x = this.touchPan.x + p.x - this.touchPan.point.x; this.view.y = this.touchPan.y + p.y - this.touchPan.point.y; this.queueRender();
    }
  }
  touchEnd(e) {
    e.preventDefault(); const remaining = this.touchPoints(e.touches);
    if (remaining.length === 1) { this.touchStartPoint = remaining[0]; this.touchPan = { point: remaining[0], x: this.view.x, y: this.view.y }; this.pinch = null; return; }
    if (remaining.length) return;
    const p = this.touchStartPoint; this.touchActive = false; this.touchPan = null; this.pinch = null;
    if (!p || this.touchMoved) return;
    if (this.drawing) return this.place(p, false);
    const segment = this.segmentAt(p); if (segment >= 0) this.openKeypad(segment);
  }
  place(p, shift) {
    const points = this.points(), start = this.screen(points[0]), target = this.world(p);
    if (points.length >= 3 && Math.hypot(p.x - start.x, p.y - start.y) < 17) return this.close();
    const from = points.at(-1); let angle = Math.atan2(target.y - from.y, target.x - from.x); angle = this.snap(angle, shift || this.state.orthogonal);
    const length = dist(from, target); if (length < .001) return;
    this.change(() => { this.state.segments.push({ length, angle }); this.nextHeading = angle; });
  }
  dragVertex(index, target, shift) {
    const p = this.points(), previous = p[index - 1], next = p[index + 1];
    if (shift || this.state.orthogonal) { const a = this.snap(Math.atan2(target.y - previous.y, target.x - previous.x), true); const d = dist(previous, target); target = { x: previous.x + d * Math.cos(a), y: previous.y + d * Math.sin(a) }; }
    const before = this.state.segments[index - 1]; before.length = dist(previous, target); before.angle = Math.atan2(target.y - previous.y, target.x - previous.x);
    if (next && this.state.segments[index]) { const after = this.state.segments[index]; after.length = dist(target, next); after.angle = Math.atan2(next.y - target.y, next.x - target.x); }
  }
  zoom(e) { e.preventDefault(); const p = this.point(e), w = this.world(p), factor = e.deltaY < 0 ? 1.12 : .89; this.view.scale = Math.max(6, Math.min(900, this.view.scale * factor)); this.view.x = p.x - w.x * this.view.scale; this.view.y = p.y + w.y * this.view.scale; this.render(); }
  keydown(e) {
    if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); this.space = true; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); return this.redo(); }
    if (e.key === "Escape") { this.drawing = false; this.diagonal = []; this.closeModal(); this.sync(); }
  }
  directLength() {
    const length = Number(byId("lengthInput").value); if (!(length > 0)) return this.toast("Enter a positive wall length.", "error"); if (this.state.closed) return this.toast("The shape is already closed.", "error");
    const heading = this.nextHeading === null ? (this.state.segments.at(-1)?.angle ?? this.state.startDirection * R) : this.nextHeading;
    this.change(() => { this.state.segments.push({ length, angle: heading }); this.nextHeading = heading; }); byId("lengthInput").value = "";
  }
  directTurn() {
    const turn = Number(byId("angleInput").value); if (!Number.isFinite(turn)) return this.toast("Enter a valid turn angle.", "error");
    const base = this.nextHeading === null ? (this.state.segments.at(-1)?.angle ?? this.state.startDirection * R) : this.nextHeading; this.nextHeading = base + turn * R; byId("angleInput").value = ""; this.toast("Next wall direction updated.", "success"); this.render();
  }
  toggleDrawer() {
    const drawer = byId("controlsDrawer"), open = drawer.classList.toggle("is-open");
    if (open) this.closeKeypad();
    byId("drawerButton").setAttribute("aria-expanded", String(open)); this.scheduleResize();
  }
  hideDrawer() {
    if (!matchMedia("(max-width: 800px)").matches) return;
    const drawer = byId("controlsDrawer"); drawer.classList.remove("is-open"); drawer.style.transform = "";
    byId("drawerButton").setAttribute("aria-expanded", "false");
  }
  startDrawerDrag(e) {
    if (!matchMedia("(max-width: 800px)").matches) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    const drawer = byId("controlsDrawer"), travel = Math.max(1, drawer.offsetHeight - 48);
    this.drawerDrag = { startY: e.clientY, travel, base: drawer.classList.contains("is-open") ? 0 : travel, moved: false };
    drawer.style.transition = "none";
  }
  moveDrawerDrag(e) {
    if (!this.drawerDrag) return;
    const drawer = byId("controlsDrawer"), delta = e.clientY - this.drawerDrag.startY, y = Math.max(0, Math.min(this.drawerDrag.travel, this.drawerDrag.base + delta));
    if (Math.abs(delta) > 5) this.drawerDrag.moved = true;
    this.drawerDrag.current = y; drawer.style.transform = "translateY(" + y + "px)";
  }
  endDrawerDrag(e) {
    if (!this.drawerDrag) return;
    const drawer = byId("controlsDrawer"), drag = this.drawerDrag, y = drag.current ?? drag.base, open = y < drag.travel / 2;
    this.suppressDrawerClick = drag.moved;
    this.drawerDrag = null; drawer.style.transition = ""; drawer.style.transform = ""; drawer.classList.toggle("is-open", open);
    byId("drawerButton").setAttribute("aria-expanded", String(open)); this.scheduleResize();
  }
  openKeypad(index) {
    if (!Number.isInteger(index) || !this.state.segments[index]) return;
    this.keypadIndex = index; this.keypadValue = String(this.state.segments[index].length);
    byId("keypadValue").textContent = this.keypadValue; byId("floatingKeypad").classList.add("open"); byId("floatingKeypad").setAttribute("aria-hidden", "false");
  }
  closeKeypad() {
    this.keypadIndex = null; byId("floatingKeypad").classList.remove("open"); byId("floatingKeypad").setAttribute("aria-hidden", "true");
  }
  keypadPress(e) {
    const button = e.target.closest("[data-key]"); if (!button) return; const key = button.dataset.key;
    if (key === "cancel") return this.closeKeypad();
    if (key === "back") this.keypadValue = this.keypadValue.slice(0, -1);
    else if (key === "apply") {
      const length = Number(this.keypadValue);
      if (!(length > 0)) return this.toast("Enter a positive wall length.", "error");
      const index = this.keypadIndex; this.change(() => { this.state.segments[index].length = length; }); return this.closeKeypad();
    } else if (key === "." ? !this.keypadValue.includes(".") : this.keypadValue.length < 12) this.keypadValue += key;
    byId("keypadValue").textContent = this.keypadValue || "0";
  }
  close() { if (this.state.segments.length < 2) return this.toast("Place at least two walls before closing.", "error"); this.change(() => { this.state.closed = true; this.drawing = false; }); }
  projectChanged() { this.change(() => { this.state.name = byId("projectName").value.trim() || "Untitled"; this.state.unit = byId("unitSelect").value; this.state.startDirection = Number(byId("startDir").value) || 0; }); }
  wallChanged(e) {
    const input = e.target; if (!input.matches("[data-wall]")) return; const i = Number(input.dataset.wall), value = Number(input.value); if (!Number.isFinite(value) || (input.dataset.field === "length" && !(value > 0))) return this.toast("Enter a valid wall value.", "error");
    this.change(() => { if (input.dataset.field === "length") this.state.segments[i].length = value; else { const previous = i ? this.state.segments[i - 1].angle : this.state.startDirection * R; this.state.segments[i].angle = previous + value * R; } });
  }
  startDiagonal() { if (this.points().length < 3) return this.toast("Add at least two walls first.", "error"); this.drawing = false; this.diagonal = [-1]; this.sync(); this.toast("Click the first vertex."); }
  pickDiagonal(index) { if (this.diagonal[0] === -1) { this.diagonal[0] = index; return this.toast("Click the second vertex."); } if (index === this.diagonal[0]) return this.toast("Choose a different vertex.", "error"); const from = this.diagonal[0]; this.diagonal = []; this.diagonalModal(from, index); this.sync(); }
  removeDiagonal(e) { const button = e.target.closest("[data-remove]"); if (button) this.change(() => this.state.diagonals.splice(Number(button.dataset.remove), 1)); }
  area() { const p = this.points(); if (!this.state.closed || p.length < 3) return 0; return Math.abs(p.reduce((sum, point, i) => { const next = p[(i + 1) % p.length]; return sum + point.x * next.y - next.x * point.y; }, 0)) / 2; }
  perimeter() { const p = this.points(); let value = this.state.segments.reduce((sum, s) => sum + s.length, 0); return this.state.closed && p.length > 1 ? value + dist(p[0], p.at(-1)) : value; }
  render() {
    if (!this.width) return; const c = this.ctx, p = this.points(); c.clearRect(0, 0, this.width, this.height); this.grid(c);
    const line = (a, b, color, width, dash) => { const x = this.screen(a), y = this.screen(b); c.strokeStyle = color; c.lineWidth = width; c.setLineDash(dash || []); c.beginPath(); c.moveTo(x.x, x.y); c.lineTo(y.x, y.y); c.stroke(); };
    this.state.diagonals.forEach((d) => { if (p[d.from] && p[d.to]) line(p[d.from], p[d.to], "#7d8597", 1, [5, 4]); });
    this.state.segments.forEach((s, i) => line(p[i], p[i + 1], "#93a6e4", 2));
    if (this.state.closed && p.length > 2) line(p.at(-1), p[0], "#10b981", 2);
    if (this.drawing && this.mouse) { const from = p.at(-1), to = this.world(this.mouse); let a = Math.atan2(to.y - from.y, to.x - from.x); a = this.snap(a, this.state.orthogonal); line(from, { x: from.x + Math.cos(a) * dist(from, to), y: from.y + Math.sin(a) * dist(from, to) }, "#7d8597", 1, [6, 5]); }
    c.setLineDash([]); p.forEach((point, i) => { const s = this.screen(point), close = i === 0 && this.drawing && this.mouse && Math.hypot(s.x - this.mouse.x, s.y - this.mouse.y) < 17; c.fillStyle = close ? "#10b981" : "#93a6e4"; c.beginPath(); c.arc(s.x, s.y, close ? 8 : 5, 0, 2 * Math.PI); c.fill(); c.fillStyle = "#d7dbe5"; c.font = "11px monospace"; c.fillText("P" + (i + 1), s.x + 8, s.y - 8); });
    this.state.segments.forEach((s, i) => { const a = this.screen(p[i]), b = this.screen(p[i + 1]); c.fillStyle = "#d7dbe5"; c.font = "10px monospace"; c.fillText(s.length.toFixed(2) + " " + this.state.unit, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 5); });
  }
  grid(c) {
    const choices = [.1, .2, .5, 1, 2, 5, 10, 20, 50, 100], step = choices.find((n) => n * this.view.scale >= 42) || 200, left = this.world({ x: 0, y: 0 }).x, right = this.world({ x: this.width, y: 0 }).x, bottom = this.world({ x: 0, y: this.height }).y, top = this.world({ x: 0, y: 0 }).y;
    c.lineWidth = 1; c.strokeStyle = "rgba(42,84,209,.17)"; c.beginPath(); for (let x = Math.floor(left / step) * step; x <= right; x += step) { const sx = this.screen({ x, y: 0 }).x; c.moveTo(sx, 0); c.lineTo(sx, this.height); } for (let y = Math.floor(bottom / step) * step; y <= top; y += step) { const sy = this.screen({ x: 0, y }).y; c.moveTo(0, sy); c.lineTo(this.width, sy); } c.stroke();
    const o = this.screen({ x: 0, y: 0 }); c.strokeStyle = "rgba(147,166,228,.5)"; c.beginPath(); c.moveTo(o.x, 0); c.lineTo(o.x, this.height); c.moveTo(0, o.y); c.lineTo(this.width, o.y); c.stroke();
  }
  sync() {
    byId("projectName").value = this.state.name; byId("unitSelect").value = this.state.unit; byId("startDir").value = this.state.startDirection; byId("drawButton").textContent = this.drawing ? "Stop drawing" : "Start drawing"; byId("orthogonalButton").setAttribute("aria-pressed", String(this.state.orthogonal)); byId("wallCount").textContent = this.state.segments.length;
    byId("areaStat").textContent = this.area().toFixed(2) + " " + this.state.unit + "²"; byId("perimeterStat").textContent = this.perimeter().toFixed(2) + " " + this.state.unit; byId("vertexStat").textContent = this.points().length; byId("toolStatus").textContent = this.diagonal.length ? "Select diagonal vertices" : this.drawing ? "Drawing: click to place a vertex" : "Select or draw a shape";
    byId("undoButton").disabled = !this.history.length; byId("redoButton").disabled = !this.future.length; this.renderWalls(); this.renderDiagonals(); this.render();
  }
  renderWalls() {
    const root = byId("wallList"); root.replaceChildren(); if (!this.state.segments.length) return root.append(this.empty("No walls yet."));
    this.state.segments.forEach((s, i) => { const row = document.createElement("div"); row.className = "wall-row"; const title = document.createElement("div"); title.className = "row-title"; title.textContent = "Wall " + (i + 1); const fields = document.createElement("div"); fields.className = "wall-inputs"; fields.append(this.wallField("Length", s.length, i, "length"), this.wallField("Turn °", degrees(normalize(s.angle - (i ? this.state.segments[i - 1].angle : this.state.startDirection * R))), i, "turn")); row.append(title, fields); root.append(row); });
  }
  wallField(label, value, wall, field) { const labelEl = document.createElement("label"), input = document.createElement("input"); labelEl.textContent = label; input.type = "number"; input.step = "any"; input.value = Number(value).toFixed(2); input.dataset.wall = wall; input.dataset.field = field; labelEl.append(input); return labelEl; }
  renderDiagonals() {
    const root = byId("diagonalList"), points = this.points(); root.replaceChildren(); if (!this.state.diagonals.length) return root.append(this.empty("No diagonals measured."));
    this.state.diagonals.forEach((d, i) => { const row = document.createElement("div"); row.className = "diagonal-row"; const text = document.createElement("div"), actual = dist(points[d.from], points[d.to]), small = document.createElement("small"); text.textContent = "P" + (d.from + 1) + " ↔ P" + (d.to + 1) + ": " + d.measured + " " + this.state.unit; small.textContent = "Calculated " + actual.toFixed(2) + " · Δ " + Math.abs(actual - d.measured).toFixed(2) + " (±" + d.tolerance + ")"; text.append(document.createElement("br"), small); const remove = document.createElement("button"); remove.type = "button"; remove.className = "button small danger"; remove.textContent = "×"; remove.dataset.remove = i; row.append(text, remove); root.append(row); });
  }
  empty(text) { const p = document.createElement("p"); p.className = "empty"; p.textContent = text; return p; }
  fit() { const p = this.points(); if (p.length < 2) { this.view = { scale: 55, x: this.width / 2, y: this.height / 2 }; return this.render(); } const x = p.map((a) => a.x), y = p.map((a) => a.y), w = Math.max(1, Math.max(...x) - Math.min(...x)), h = Math.max(1, Math.max(...y) - Math.min(...y)); this.view.scale = Math.max(6, Math.min((this.width - 100) / w, (this.height - 100) / h)); this.view.x = this.width / 2 - (Math.min(...x) + Math.max(...x)) * this.view.scale / 2; this.view.y = this.height / 2 + (Math.min(...y) + Math.max(...y)) * this.view.scale / 2; this.render(); }
  payload() { const walls = this.state.segments.map((s, i) => ({ length: s.length, turn_deg: degrees(normalize(s.angle - (i ? this.state.segments[i - 1].angle : this.state.startDirection * R))) })); if (this.state.closed) { const p = this.points(); walls.push({ length: dist(p[0], p.at(-1)), turn_deg: 0 }); } return { name: this.state.name, unit: this.state.unit, start_direction_deg: this.state.startDirection, last_wall_closes_to_start: this.state.closed, walls, diagonals: this.state.diagonals.map((d) => ({ from_point_index: d.from, to_point_index: d.to, measured_length: d.measured, tolerance: d.tolerance })) }; }
  async request(url, options) { let response; try { response = await fetch(url, Object.assign({ headers: { "Content-Type": "application/json" } }, options)); } catch (_) { throw new Error("Cannot reach the server."); } const data = await response.json().catch(() => ({})); if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed."); return data.data || data; }
  async saveProject() { const b = byId("saveButton"); b.disabled = true; try { const p = await this.request("/api/projects", { method: "POST", body: JSON.stringify(this.payload()) }); this.toast("Saved " + p.name + ".", "success"); await this.refreshProjects(); } catch (e) { this.toast(e.message, "error"); } finally { b.disabled = false; } }
  async refreshProjects() { try { const data = await this.request("/api/projects"); const select = byId("projectsList"), old = select.value; select.replaceChildren(new Option("Choose a project", "")); data.projects.forEach((p) => select.add(new Option(p.name, p.id))); select.value = old; } catch (e) { this.toast(e.message, "error"); } }
  async loadProject() { const id = byId("projectsList").value; if (!id) return this.toast("Select a saved project first.", "error"); try { const data = await this.request("/api/projects/" + id); const p = data.project; this.change(() => { this.state.name = p.name || "Untitled"; this.state.unit = p.unit || "m"; this.state.startDirection = Number(p.start_direction_deg) || 0; this.state.closed = Boolean(p.last_wall_closes_to_start); let heading = this.state.startDirection * R; const walls = this.state.closed ? p.walls.slice(0, -1) : p.walls; this.state.segments = walls.map((w) => { heading += (Number(w.turn_deg) || 0) * R; return { length: Number(w.length), angle: heading }; }); this.state.diagonals = (p.diagonals || []).map((d) => ({ from: d.from_point_index, to: d.to_point_index, measured: d.measured_length, tolerance: d.tolerance || .05 })); }); this.fit(); this.toast("Project loaded.", "success"); } catch (e) { this.toast(e.message, "error"); } }
  deleteProject() { const id = byId("projectsList").value; if (!id) return this.toast("Select a saved project first.", "error"); this.modal("Delete project?", "This removes the selected project from the server.", async () => { await this.request("/api/projects/" + id, { method: "DELETE" }); await this.refreshProjects(); this.toast("Project deleted.", "success"); }); }
  confirmClear() { this.modal("Clear shape?", "All walls and diagonals will be removed.", () => this.change(() => { this.state.segments = []; this.state.diagonals = []; this.state.closed = false; this.drawing = false; this.nextHeading = null; this.fit(); })); }
  diagonalModal(from, to) { this.modal("Add measured diagonal", "Record P" + (from + 1) + " to P" + (to + 1) + ".", () => { const measured = Number(byId("modalLength").value), tolerance = Number(byId("modalTolerance").value); if (!(measured > 0) || !(tolerance >= 0)) { this.toast("Enter a valid length and margin.", "error"); return false; } this.change(() => this.state.diagonals.push({ from, to, measured, tolerance })); }, true); }
  toast(message, type) { const item = document.createElement("div"); item.className = "toast " + (type || ""); item.textContent = message; byId("toastContainer").append(item); setTimeout(() => item.remove(), 4000); }
  modal(title, description, action, diagonal) {
    const root = byId("modalRoot"); root.replaceChildren(); const box = document.createElement("section"); box.className = "modal"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); const h = document.createElement("h2"); h.textContent = title; const p = document.createElement("p"); p.textContent = description; box.append(h, p);
    if (diagonal) { const a = document.createElement("label"), ai = document.createElement("input"), b = document.createElement("label"), bi = document.createElement("input"); a.textContent = "Measured length"; ai.id = "modalLength"; ai.type = "number"; ai.min = ".001"; ai.step = "any"; a.append(ai); b.textContent = "Error margin (±)"; bi.id = "modalTolerance"; bi.type = "number"; bi.min = "0"; bi.step = "any"; bi.value = ".05"; b.append(bi); box.append(a, b); }
    const controls = document.createElement("div"); controls.className = "button-row"; const cancel = document.createElement("button"), confirm = document.createElement("button"); cancel.type = confirm.type = "button"; cancel.className = "button"; confirm.className = "button primary"; cancel.textContent = "Cancel"; confirm.textContent = "Confirm"; cancel.addEventListener("click", () => this.closeModal()); confirm.addEventListener("click", async () => { try { if (await action() !== false) this.closeModal(); } catch (e) { this.toast(e.message, "error"); } }); controls.append(cancel, confirm); box.append(controls); root.append(box); root.classList.add("open"); (diagonal ? byId("modalLength") : confirm).focus();
  }
  closeModal() { const root = byId("modalRoot"); root.classList.remove("open"); root.replaceChildren(); }
}
new AreaCalculator();
