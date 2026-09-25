import math
import json
import uuid
import os
import socket
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, request, jsonify, render_template

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

PROJECTS_DIR = Path(__file__).parent / "projects"
PROJECTS_DIR.mkdir(exist_ok=True)

UNIT_TO_METERS = {
    "mm": 0.001,
    "cm": 0.01,
    "dm": 0.1,
    "m": 1.0,
    "hm": 100.0,
}

SQUARE_UNIT_LABELS = {
    "mm": "mm²",
    "cm": "cm²",
    "dm": "dm²",
    "m": "m²",
    "hm": "hm²",
}

UNIT_AREA_FACTOR = {
    "mm": 1_000_000.0,
    "cm": 10_000.0,
    "dm": 100.0,
    "m": 1.0,
    "hm": 0.0001,
}

def ok(data=None, status=200):
    """Return the consistent API envelope used by the client."""
    return jsonify({"ok": True, "data": data or {}}), status

def error(message, status=400):
    return jsonify({"ok": False, "error": message}), status

def valid_project_id(project_id):
    return isinstance(project_id, str) and len(project_id) == 32 and all(c in "0123456789abcdef" for c in project_id)

def project_path(project_id):
    return PROJECTS_DIR / f"{project_id}.json"

def get_lan_ip():
    """Find the outbound LAN IPv4 address without DNS or hostname guessing."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No traffic is sent by UDP connect; it only selects the local interface.
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        return ip if not ip.startswith("127.") else None
    except OSError:
        return None
    finally:
        sock.close()

@app.errorhandler(404)
def api_not_found(_):
    if request.path.startswith("/api/"):
        return error("Endpoint not found.", 404)
    return "Not found", 404

@app.errorhandler(500)
def api_server_error(_):
    return error("The server could not complete the request.", 500)

def segments_intersect(p1, p2, p3, p4):
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    d1 = cross(p3, p4, p1)
    d2 = cross(p3, p4, p2)
    d3 = cross(p1, p2, p3)
    d4 = cross(p1, p2, p4)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    return False

def check_self_intersection(points):
    n = len(points)
    if n < 4: return False
    edges = [(points[i], points[(i + 1) % n]) for i in range(n)]
    for i in range(len(edges)):
        for j in range(i + 2, len(edges)):
            if i == 0 and j == len(edges) - 1: continue
            if segments_intersect(edges[i][0], edges[i][1], edges[j][0], edges[j][1]):
                return True
    return False

def shoelace_area(points):
    n = len(points)
    if n < 3: return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += points[i][0] * points[j][1]
        area -= points[j][0] * points[i][1]
    return abs(area) / 2.0

def ceil_with_epsilon(value):
    if value == 0: return 0
    return math.ceil(value - 0.000000001)

def calculate_project(data):
    warnings = []
    unit = data.get("unit", "m")
    if unit not in UNIT_TO_METERS:
        return {"ok": False, "error": f"Invalid unit: {unit}."}
    factor = UNIT_TO_METERS[unit]
    start_dir = data.get("start_direction_deg", 0)
    last_closes = data.get("last_wall_closes_to_start", True)
    walls = data.get("walls", [])
    diagonals = data.get("diagonals", [])

    if not walls:
        return {"ok": False, "error": "No walls defined."}

    walls_to_build = walls[:-1] if (last_closes and len(walls) > 0) else walls
    closing_wall = walls[-1] if (last_closes and len(walls) > 0) else None

    for i, wall in enumerate(walls_to_build):
        length = wall.get("length")
        if length is None or length == "": return {"ok": False, "error": f"Wall {i + 1} has no length."}
        try: length = float(length)
        except: return {"ok": False, "error": f"Wall {i + 1} has invalid length."}
        if length <= 0: return {"ok": False, "error": f"Wall {i + 1} has non-positive length."}

    points = [(0.0, 0.0)]
    heading = math.radians(start_dir)
    for wall in walls_to_build:
        turn_deg = wall.get("turn_deg", 0)
        try: turn_deg = float(turn_deg)
        except: turn_deg = 0.0
        heading += math.radians(turn_deg)
        length_m = float(wall["length"]) * factor
        last_x, last_y = points[-1]
        x = last_x + length_m * math.cos(heading)
        y = last_y + length_m * math.sin(heading)
        points.append((x, y))

    if len(points) < 3:
        return {"ok": False, "error": f"Need at least 3 polygon vertices (got {len(points)})."}

    last_point = points[-1]
    first_point = points[0]
    calculated_closing_m = math.hypot(last_point[0] - first_point[0], last_point[1] - first_point[1])
    measured_closing_m = None
    closing_difference_m = None

    if last_closes and closing_wall is not None:
        cl = closing_wall.get("length")
        if cl is not None and cl != "":
            try:
                measured_closing_m = float(cl) * factor
                closing_difference_m = abs(measured_closing_m - calculated_closing_m)
                if closing_difference_m > 0.1: warnings.append(f"Closing wall difference is {closing_difference_m:.4f} m (significant).")
                elif closing_difference_m > 0.02: warnings.append(f"Closing wall difference is {closing_difference_m:.4f} m.")
            except: pass

    area_m2 = shoelace_area(points)
    perimeter_m = sum(math.hypot(points[(i+1)%len(points)][0] - points[i][0], points[(i+1)%len(points)][1] - points[i][1]) for i in range(len(points)))

    if check_self_intersection(points):
        warnings.append("Polygon edges cross. The area may not be meaningful.")

    area_factor = UNIT_AREA_FACTOR[unit]
    area_display = area_m2 * area_factor
    rounded_display = ceil_with_epsilon(area_display)
    display_unit = SQUARE_UNIT_LABELS[unit]

    diagonal_checks = []
    for diag in diagonals:
        fi = diag.get("from_point_index")
        ti = diag.get("to_point_index")
        ml = diag.get("measured_length")
        check = {"from_point_index": fi, "to_point_index": ti, "calculated_m": None, "measured_m": None, "difference_m": None, "ok": False, "warning": None}
        try:
            fi, ti = int(fi), int(ti)
        except:
            check["warning"] = "Invalid point indices."
            diagonal_checks.append(check)
            continue
        if fi < 0 or fi >= len(points) or ti < 0 or ti >= len(points):
            check["warning"] = f"Point index out of range (0-{len(points)-1})."
            diagonal_checks.append(check)
            continue

        calc_dist = math.hypot(points[fi][0] - points[ti][0], points[fi][1] - points[ti][1])
        check["calculated_m"] = round(calc_dist, 6)
        if ml is not None and ml != "":
            try:
                meas_m = float(ml) * factor
                check["measured_m"] = round(meas_m, 6)
                diff = abs(calc_dist - meas_m)
                check["difference_m"] = round(diff, 6)
                if diff <= 0.05: check["ok"] = True
                elif diff <= 0.20: check["warning"] = f"Diagonal P{fi+1}-P{ti+1} differs by {diff:.4f} m."
                else: check["warning"] = f"Diagonal P{fi+1}-P{ti+1} differs by {diff:.4f} m (large discrepancy!)"
            except: check["warning"] = "Invalid measured length."
        else: check["ok"] = True
        diagonal_checks.append(check)

    return {
        "ok": True,
        "points_m": [{"x": round(p[0], 6), "y": round(p[1], 6)} for p in points],
        "area_m2": round(area_m2, 6),
        "area_display": round(area_display, 6),
        "display_unit": display_unit,
        "rounded_display_area": rounded_display,
        "perimeter_m": round(perimeter_m, 6),
        "calculated_closing_length_m": round(calculated_closing_m, 6),
        "measured_closing_length_m": round(measured_closing_m, 6) if measured_closing_m is not None else None,
        "closing_difference_m": round(closing_difference_m, 6) if closing_difference_m is not None else None,
        "warnings": warnings,
        "diagonal_checks": diagonal_checks,
    }

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/calculate", methods=["POST"])
def api_calculate():
    try: data = request.get_json(force=True)
    except: return jsonify({"ok": False, "error": "Invalid JSON payload."}), 400
    if not isinstance(data, dict): return error("Request body must be an object.", 400)
    result = calculate_project(data)
    if not result.get("ok"): return error(result["error"], 400)
    result.pop("ok", None)
    return ok(result)

@app.route("/api/projects", methods=["GET"])
def api_list_projects():
    projects = []
    for f in PROJECTS_DIR.glob("*.json"):
        try:
            with open(f, "r") as fh: d = json.load(fh)
            projects.append({"id": d.get("id", f.stem), "name": d.get("name", "Untitled"), "unit": d.get("unit", "m"), "savedAt": d.get("savedAt", "")})
        except: continue
    projects.sort(key=lambda p: p.get("savedAt", ""), reverse=True)
    return ok({"projects": projects})

@app.route("/api/projects", methods=["POST"])
def api_save_project():
    try: data = request.get_json(force=True)
    except: return jsonify({"ok": False, "error": "Invalid JSON payload."}), 400
    if not isinstance(data, dict): return error("Request body must be an object.", 400)
    name = str(data.get("name", "Untitled")).strip()[:100] or "Untitled"
    unit = data.get("unit", "m")
    if unit not in UNIT_TO_METERS:
        return error("Invalid unit.", 400)
    if not isinstance(data.get("walls", []), list) or not isinstance(data.get("diagonals", []), list):
        return error("Walls and diagonals must be lists.", 400)
    project_id = uuid.uuid4().hex
    project = {"version": 2, "id": project_id, "name": name, "unit": unit, "start_direction_deg": data.get("start_direction_deg", 0), "last_wall_closes_to_start": bool(data.get("last_wall_closes_to_start", True)), "walls": data["walls"], "diagonals": data["diagonals"], "savedAt": datetime.now(timezone.utc).isoformat()}
    try:
        with open(project_path(project_id), "w", encoding="utf-8") as f:
            json.dump(project, f, indent=2)
    except OSError:
        return error("Project could not be saved.", 500)
    return ok({"id": project_id, "name": project["name"]}, 201)

@app.route("/api/projects/<project_id>", methods=["GET"])
def api_load_project(project_id):
    if not valid_project_id(project_id): return error("Invalid project ID.", 400)
    filepath = project_path(project_id)
    if not filepath.exists(): return jsonify({"ok": False, "error": "Project not found."}), 404
    try:
        with open(filepath, "r", encoding="utf-8") as f: project = json.load(f)
    except (OSError, json.JSONDecodeError):
        return error("Saved project is unreadable.", 500)
    return ok({"project": project})

@app.route("/api/projects/<project_id>", methods=["DELETE"])
def api_delete_project(project_id):
    if not valid_project_id(project_id):
        return error("Invalid project ID.", 400)
    filepath = project_path(project_id)
    if not filepath.exists():
        return error("Project not found.", 404)
    try:
        filepath.unlink()
    except OSError:
        return error("Project could not be deleted.", 500)
    return ok({"id": project_id})

if __name__ == "__main__":
    try:
        port = int(os.environ.get("PORT", "5000"))
    except ValueError:
        port = 5000
    lan_ip = get_lan_ip()
    print("\n" + "=" * 54)
    print("  Irregular Shapes Area Calculator")
    print("=" * 54)
    print(f"  Local:  http://127.0.0.1:{port}")
    if lan_ip:
        print(f"  LAN:    http://{lan_ip}:{port}")
        print("  On your phone, join the same Wi-Fi network and")
        print("  open the LAN URL above in the browser.")
    else:
        print("  LAN IP unavailable. Check your active Wi-Fi connection.")
    print("=" * 54 + "\n")
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1", host="0.0.0.0", port=port)
