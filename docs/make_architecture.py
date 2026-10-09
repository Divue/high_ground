"""Draw docs/architecture.png (for the README and the demo video)."""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

SKY, ASPHALT, SHALLOW, DEEP, AMBER, GREY = "#14303D", "#3E5560", "#7FD3D8", "#1C6E9C", "#F2A541", "#C9D4D8"
fig, ax = plt.subplots(figsize=(16, 9.6), dpi=120)
plt.subplots_adjust(0.01, 0.01, 0.99, 0.99)
fig.patch.set_facecolor("#0E2530")
ax.set_facecolor("#0E2530")
ax.set_xlim(0, 160)
ax.set_ylim(0, 96)
ax.axis("off")


def box(x, y, w, h, title, lines=(), edge=ASPHALT, title_color=GREY, fill=SKY):
    h = max(h, 7.5 + 3.05 * len(lines))
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1.5", fc=fill, ec=edge, lw=1.6))
    ax.text(x + 1.5, y + h - 2.6, title, color=title_color, fontsize=11.5, fontweight="bold", va="top")
    for i, t in enumerate(lines):
        ax.text(x + 1.5, y + h - 6.4 - i * 3.05, t, color="#A9B8BE", fontsize=9.0, va="top")
    return y + h


def arrow(x0, y0, x1, y1, color=GREY, label=None, style="-|>"):
    ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle=style, mutation_scale=12, color=color, lw=1.3,
                                 connectionstyle="arc3,rad=0.0"))
    if label:
        ax.text((x0 + x1) / 2, (y0 + y1) / 2 + 1.2, label, color="#8FA2AA", fontsize=8.2, ha="center")


ax.text(2, 94, "HighGround architecture", color=GREY, fontsize=18, fontweight="bold", va="top")
ax.text(2, 89.5, "Offline model on the laptop; everything residents touch runs on AWS.", color="#8FA2AA", fontsize=10.5, va="top")

# offline column
ax.text(2, 83, "Offline (Python)", color=SHALLOW, fontsize=12, fontweight="bold")
box(2, 58, 44, 22, "Open data on AWS (S3, no account)", [
    "Copernicus DEM GLO-30  s3://copernicus-dem-30m",
    "ESA WorldCover 2021  s3://esa-worldcover",
    "OpenStreetMap (roads, buildings, rivers,",
    "  hospitals, bridges, parking)",
    "Open-Meteo ERA5 timing, IMD storm totals"])
box(2, 25.5, 44, 29, "Flood model", [
    "Bare-earth terrain from the DSM, rivers burnt",
    "Local-inertial 2D solver (numba), 30 m,",
    "  1.2 M cells, mass error < 0.01%",
    "12 design storms + 2015, Michaung, Fengal",
    "Drain capacity: stated assumption;",
    "  tested on held-out even wards (2015)",
    "ANUGA cross-check for Velachery"], edge=DEEP)
box(2, 1.5, 44, 19.7, "Outputs", [
    "Depth textures (hourly), terrain-RGB tiles",
    "Street JSON: depth, time to 15 cm",
    "Routing graph + edge depths per storm",
    "Dry parking, hospital reachability, proof.json"])
arrow(24, 58, 24, 55.2)
arrow(24, 25.5, 24, 22.2)

# AWS column
ax.text(56, 83, "On AWS", color=AMBER, fontsize=12, fontweight="bold")
box(56, 63, 46, 17, "S3 + CloudFront", ["Model outputs, PMTiles basemap, terrain tiles",
                                          "Origin Access Control, CORS, gzip",
                                          "current.json uncached (updated every 3 h)"], edge=AMBER)
box(56, 33, 46, 26, "Alerts", ["EventBridge Scheduler (every 3 h) / Run now",
                               "-> Lambda forecast-check: Open-Meteo, 4 points",
                               "-> nearest storms + blend -> current.json",
                               "-> risk band changed? Amazon Bedrock writes",
                               "   two sentences -> Amazon SNS email",
                               "Lambda subscribe -> DynamoDB + SNS filter policy"], edge=AMBER)
box(56, 1.5, 46, 29, "Ask HighGround", ["API Gateway -> Lambda (Strands Agents SDK)",
                                      "-> Claude on Amazon Bedrock",
                                      "Tools read only model outputs:",
                                      "  get_street_risk, find_dry_parking, safe_route,",
                                      "  hospital_status, current_forecast, model_limits",
                                      "Every number checked against tool output",
                                      "Lambda geocode -> Amazon Location Service"], edge=AMBER)
arrow(46, 12, 56, 70, label="sync to S3")

# browser column
ax.text(112, 83, "Browser", color=SHALLOW, fontsize=12, fontweight="bold")
box(112, 45, 46, 35, "Amplify Hosting: React app", ["MapLibre GL: dark basemap, 3D terrain,",
                                                      "  extruded buildings",
                                                      "three.js custom layer: water plane driven",
                                                      "  by depth textures, ripples, rain",
                                                      "Scrub hours, what-if slider, replays:",
                                                      "  texture blends, no compute",
                                                      "A* dry routing in the browser",
                                                      "Proof: swipe vs 2015 citizen reports"], edge=SHALLOW)
box(112, 12, 46, 23, "Resident", ["Types an address", "Sees depth + time for their street",
                                  "Dry parking + a route that avoids water",
                                  "Email when the risk changes",
                                  "SMS: coming soon (TRAI DLT)"], fill="#183843")
arrow(102, 72, 112, 70, label="tiles, JSON")
arrow(102, 46, 112, 54, label="subscribe")
arrow(102, 16, 112, 49, label="ask, geocode")
arrow(135, 45, 135, 37.6)

out = Path(__file__).with_name("architecture.png")
plt.savefig(out, facecolor=fig.get_facecolor())
print(out)
