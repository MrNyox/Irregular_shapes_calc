// --- STATE ---
let segments = []; // { length: number, angle: number (radians), isSet: boolean }
let diagonals = []; // { from: index, to: index, measured: number }
let isClosed = false;
let drawMode = false;
let diagonalMode = 0; // 0=off, 1=pick1, 2=pick2
let tempDiagonal = {};

let view = { scale: 10, offsetX: 0, offsetY: 0 };
let mousePos = null;
let isDragging = false;
let dragIndex = -1;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// --- INIT & RESIZE ---
function resizeCanvas() {
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    if (segments.length === 0) {
        view.offsetX = canvas.width / 2;
        view.offsetY = canvas.height / 2;
    }
    draw();
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
    resizeCanvas();
    refreshProjects();
});

// --- MATH HELPERS ---
function getPoints() {
    let pts = [{x: 0, y: 0}];
    let curr = {x: 0, y: 0};
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        curr = {
            x: curr.x + seg.length * Math.cos(seg.angle),
            y: curr.y + seg.length * Math.sin(seg.angle)
        };
        pts.push(curr);
    }
    return pts;
}

function screenToReal(sx, sy) {
    return {
        x: (sx - view.offsetX) / view.scale,
        y: (view.offsetY - sy) / view.scale // Inverted Y
    };
}

function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx*dx + dy*dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function getHit(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pts = getPoints();

    for (let i = 0; i < pts.length; i++) {
        const sx = pts[i].x * view.scale + view.offsetX;
        const sy = -pts[i].y * view.scale + view.offsetY;
        if (Math.hypot(mx - sx, my - sy) < 15) return { type: 'point', index: i };
    }

    for (let i = 0; i < segments.length; i++) {
        const p1 = pts[i], p2 = pts[i+1];
        const sx1 = p1.x * view.scale + view.offsetX, sy1 = -p1.y * view.scale + view.offsetY;
        const sx2 = p2.x * view.scale + view.offsetX, sy2 = -p2.y * view.scale + view.offsetY;
        if (distToSegment(mx, my, sx1, sy1, sx2, sy2) < 8) return { type: 'segment', index: i };
    }
    return null;
}

// --- DRAWING ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pts = getPoints();

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, -view.scale);

    // Diagonals
    ctx.strokeStyle = '#888';
    ctx.setLineDash([5 / view.scale, 5 / view.scale]);
    ctx.lineWidth = 1 / view.scale;
    diagonals.forEach(d => {
        if (pts[d.from] && pts[d.to]) {
            ctx.beginPath();
            ctx.moveTo(pts[d.from].x, pts[d.from].y);
            ctx.lineTo(pts[d.to].x, pts[d.to].y);
            ctx.stroke();
        }
    });

    // Segments
    ctx.lineWidth = 2 / view.scale;
    for (let i = 0; i < segments.length; i++) {
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[i+1].x, pts[i+1].y);

        if (!segments[i].isSet) {
            ctx.strokeStyle = '#f0ad4e';
            ctx.setLineDash([5 / view.scale, 5 / view.scale]);
        } else {
            ctx.strokeStyle = '#2a6db5';
            ctx.setLineDash([]);
        }
        ctx.stroke();
    }

    // Closing line visual
    if (isClosed && pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.lineTo(pts[0].x, pts[0].y);
        ctx.strokeStyle = '#2a6db5';
        ctx.setLineDash([]);
        ctx.stroke();
    }

    // Points
    ctx.fillStyle = '#333';
    ctx.setLineDash([]);
    const r = 5 / view.scale;
    pts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.restore();

    // Labels (Screen Coords)
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';

    pts.forEach((p, i) => {
        const sx = p.x * view.scale + view.offsetX;
        const sy = -p.y * view.scale + view.offsetY;
        ctx.fillText(`P${i + 1}`, sx, sy - 10);
    });

    ctx.fillStyle = '#555';
    ctx.font = 'bold 11px sans-serif';
    for (let i = 0; i < segments.length; i++) {
        const p1 = pts[i], p2 = pts[i+1];
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        const smx = mx * view.scale + view.offsetX;
        const smy = -my * view.scale + view.offsetY;

        ctx.save();
        ctx.translate(smx, smy);
        let angle = Math.atan2(-(p2.y - p1.y), p2.x - p1.x); // Screen angle
        if (angle > Math.PI/2 || angle < -Math.PI/2) angle += Math.PI; // Keep text upright
        ctx.rotate(angle);
        ctx.fillText(`${segments[i].length.toFixed(2)} ${document.getElementById('unitSelect').value}`, 0, -6);
        ctx.restore();
    }

    // Draw Mode Preview
    if (drawMode && pts.length > 0 && mousePos) {
        const last = pts[pts.length - 1];
        const realMouse = screenToReal(mousePos.x, mousePos.y);
        ctx.save();
        ctx.translate(view.offsetX, view.offsetY);
        ctx.scale(view.scale, -view.scale);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(realMouse.x, realMouse.y);
        ctx.strokeStyle = '#999';
        ctx.setLineDash([5 / view.scale, 5 / view.scale]);
        ctx.lineWidth = 1 / view.scale;
        ctx.stroke();
        ctx.restore();
    }
}

// --- INTERACTIONS ---
canvas.addEventListener('mousedown', (e) => {
    if (drawMode || diagonalMode > 0) return;
    const hit = getHit(e);
    if (hit && hit.type === 'point' && hit.index > 0) {
        isDragging = true;
        dragIndex = hit.index;
        canvas.style.cursor = 'grabbing';
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (isDragging && dragIndex > 0) {
        const realMouse = screenToReal(mousePos.x, mousePos.y);
        const pts = getPoints();
        const prevPt = pts[dragIndex - 1];
        segments[dragIndex - 1].angle = Math.atan2(realMouse.y - prevPt.y, realMouse.x - prevPt.x);
        draw();
    } else {
        const hit = getHit(e);
        if (hit && hit.type === 'point') canvas.style.cursor = 'grab';
        else if (hit && hit.type === 'segment') canvas.style.cursor = 'pointer';
        else canvas.style.cursor = drawMode ? 'crosshair' : 'default';

        if (drawMode) draw();
    }
});

canvas.addEventListener('mouseup', () => { isDragging = false; dragIndex = -1; });

canvas.addEventListener('click', (e) => {
    if (drawMode) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const realMouse = screenToReal(mx, my);
        const pts = getPoints();

        if (pts.length >= 3) {
            const p1 = pts[0];
            if (Math.hypot(realMouse.x - p1.x, realMouse.y - p1.y) * view.scale < 15) {
                isClosed = true;
                drawMode = false;
                updateUI();
                draw();
                return;
            }
        }

        const lastPt = pts[pts.length - 1];
        segments.push({
            length: 1.0,
            angle: Math.atan2(realMouse.y - lastPt.y, realMouse.x - lastPt.x),
            isSet: false
        });
        draw();
    } else if (diagonalMode > 0) {
        const hit = getHit(e);
        if (hit && hit.type === 'point') {
            if (diagonalMode === 1) {
                tempDiagonal.from = hit.index;
                diagonalMode = 2;
                alert('Click the second point.');
            } else if (diagonalMode === 2 && hit.index !== tempDiagonal.from) {
                tempDiagonal.to = hit.index;
                const meas = prompt('Enter measured diagonal length:');
                if (meas !== null && !isNaN(parseFloat(meas))) {
                    diagonals.push({ from: tempDiagonal.from, to: tempDiagonal.to, measured: parseFloat(meas) });
                }
                diagonalMode = 0;
                canvas.style.cursor = 'default';
                draw();
            }
        }
    } else {
        const hit = getHit(e);
        if (hit && hit.type === 'segment') {
            showLengthPopup(hit.index, e.clientX, e.clientY);
        } else {
            closePopup();
        }
    }
});

// --- UI ACTIONS ---
function toggleDrawMode() {
    if (isClosed) { alert('Shape is closed. Clear to start over.'); return; }
    drawMode = !drawMode;
    updateUI();
    draw();
}

function updateUI() {
    const btn = document.getElementById('btnDraw');
    if (drawMode) {
        btn.textContent = 'Stop Drawing';
        btn.classList.add('active');
    } else {
        btn.textContent = 'Draw Mode (+)';
        btn.classList.remove('active');
    }
}

function clearCanvas() {
    if (confirm('Clear all points and start over?')) {
        segments = []; diagonals = []; isClosed = false; drawMode = false;
        updateUI(); fitToScreen(); draw();
    }
}

function fitToScreen() {
    const pts = getPoints();
    if (pts.length === 0) { view.scale = 10; view.offsetX = canvas.width/2; view.offsetY = canvas.height/2; return; }
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    pts.forEach(p => { minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x); minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y); });
    const w = maxX-minX||1, h = maxY-minY||1, pad = 60;
    view.scale = Math.min((canvas.width-2*pad)/w, (canvas.height-2*pad)/h);
    view.offsetX = canvas.width/2 - ((minX+maxX)/2)*view.scale;
    view.offsetY = canvas.height/2 + ((minY+maxY)/2)*view.scale;
    draw();
}

function showLengthPopup(idx, cx, cy) {
    const popup = document.getElementById('lengthPopup');
    const rect = canvas.parentElement.getBoundingClientRect();
    popup.style.left = (cx - rect.left + 15) + 'px';
    popup.style.top = (cy - rect.top + 15) + 'px';
    popup.style.display = 'block';
    popup.dataset.segIndex = idx;
    document.getElementById('popupLengthInput').value = segments[idx].length;
    document.getElementById('popupLengthInput').focus();
}

function closePopup() { document.getElementById('lengthPopup').style.display = 'none'; }

function setLength() {
    const val = parseFloat(document.getElementById('popupLengthInput').value);
    if (!isNaN(val) && val > 0) {
        const idx = parseInt(document.getElementById('lengthPopup').dataset.segIndex);
        segments[idx].length = val;
        segments[idx].isSet = true;
        closePopup();
        draw();
    } else { alert('Invalid length.'); }
}

document.getElementById('popupLengthInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') setLength(); });

function addDiagonal() {
    if (getPoints().length < 2) { alert('Need at least 2 points.'); return; }
    diagonalMode = 1;
    canvas.style.cursor = 'crosshair';
    alert('Click the FIRST point for the diagonal.');
}

// --- API & BACKEND SYNC ---
function getBackendPayload() {
    const unit = document.getElementById('unitSelect').value;
    const startDir = parseFloat(document.getElementById('startDir').value) || 0;
    let walls = [];

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        let turnDeg;
        if (i === 0) {
            turnDeg = seg.angle * 180 / Math.PI;
        } else {
            let diff = (seg.angle - segments[i-1].angle) * 180 / Math.PI;
            while (diff > 180) diff -= 360;
            while (diff < -180) diff += 360;
            turnDeg = diff;
        }
        walls.push({ length: seg.length, turn_deg: turnDeg });
    }

    if (isClosed) {
        const pts = getPoints();
        const last = pts[pts.length - 1];
        walls.push({ length: Math.hypot(last.x, last.y), turn_deg: 0 });
    }

    return {
        name: document.getElementById('projectName').value,
        unit: unit,
        start_direction_deg: startDir,
        last_wall_closes_to_start: isClosed,
        walls: walls,
        diagonals: diagonals.map(d => ({
            from_point_index: d.from, to_point_index: d.to, measured_length: d.measured
        }))
    };
}

async function calculate() {
    const resBox = document.getElementById('resultsContainer');
    resBox.innerHTML = '<p>Calculating...</p>';
    try {
        const resp = await fetch('/api/calculate', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(getBackendPayload())
        });
        const r = await resp.json();
        if (!r.ok) { resBox.innerHTML = `<div class="warning">Error: ${r.error}</div>`; return; }

        let html = `<div class="highlight">Area: ${r.rounded_display_area} ${r.display_unit}</div>`;
        html += `Exact: ${r.area_display} ${r.display_unit}<br>`;
        if (document.getElementById('unitSelect').value !== 'm') html += `In m²: ${r.area_m2} m²<br>`;
        html += `Perimeter: ${r.perimeter_m} m<br>`;

        if (r.measured_closing_length_m !== null) {
            html += `Closing diff: ${r.closing_difference_m} m<br>`;
        }

        r.warnings.forEach(w => html += `<div class="warning">⚠ ${w}</div>`);
        resBox.innerHTML = html;
    } catch (e) {
        resBox.innerHTML = `<div class="warning">Network Error</div>`;
    }
}

async function saveProject() {
    const resp = await fetch('/api/projects', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(getBackendPayload())
    });
    const r = await resp.json();
    if (r.ok) { alert(`Saved: ${r.name}`); refreshProjects(); }
    else alert('Save failed.');
}

async function refreshProjects() {
    const resp = await fetch('/api/projects');
    const r = await resp.json();
    const sel = document.getElementById('projectsList');
    sel.innerHTML = '<option value="">-- Select --</option>';
    if (r.ok) r.projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

async function loadSelectedProject() {
    const id = document.getElementById('projectsList').value;
    if (!id) return;
    const resp = await fetch(`/api/projects/${id}`);
    const r = await resp.json();
    if (!r.ok) return;

    const p = r.project;
    document.getElementById('projectName').value = p.name;
    document.getElementById('unitSelect').value = p.unit;
    document.getElementById('startDir').value = p.start_direction_deg;

    segments = [];
    isClosed = p.last_wall_closes_to_start;
    let currAngle = (p.start_direction_deg || 0) * Math.PI / 180;

    const walls = isClosed ? p.walls.slice(0, -1) : p.walls;
    walls.forEach(w => {
        currAngle += (w.turn_deg || 0) * Math.PI / 180;
        segments.push({ length: w.length, angle: currAngle, isSet: true });
    });

    diagonals = p.diagonals.map(d => ({ from: d.from_point_index, to: d.to_point_index, measured: d.measured_length }));
    drawMode = false;
    updateUI();
    fitToScreen();
    calculate();
}
