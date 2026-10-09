"""assistant: POST /ask {question, lat?, lon?, place?, scenario?}

A Strands Agents SDK agent on Amazon Bedrock. Its only knowledge is six grounded tools
that read HighGround model outputs from S3. After the agent answers, every number in
the reply is checked against the tool outputs; the response lists which numbers are
grounded so the UI can mark them "from the model".
"""
from __future__ import annotations

import json
import os
import re

from strands import Agent, tool
from strands.models import BedrockModel

import hg

SYSTEM = """You are HighGround, a flood assistant for residents of Chennai.
Rules you must follow:
1. Answer only from tool results. Call a tool before giving any depth, time, distance, count or rainfall.
2. Never state a number that is not in a tool result. If a tool has no data, say so plainly.
3. Quote the scenario (tonight's forecast blend or the named replay storm) and the forecast time when you give depths.
4. If someone describes danger (water rising inside a home, someone trapped, a person in water, live wires), tell them to call 112 first, before anything else.
5. Keep answers short: two to four sentences, plain English, no markdown tables, no bullet lists unless asked.
6. Depth bands: under 5 cm dry; 5–15 cm wet; 15–30 cm unsafe for two-wheelers; over 30 cm unsafe for cars.
7. You are not an official warning service; say so only if asked about official status.
"""

CALLS: list = []
CTX: dict = {}


def _log(name, args, out):
    CALLS.append({"tool": name, "input": args, "output": out})
    return out


def _sc():
    return CTX.get("scenario")


@tool
def get_street_risk(lat: float, lon: float) -> dict:
    """Flood risk for the street nearest to a point: peak depth (cm), risk band, the clock time it
    reaches 15 cm, the peak time, and hourly depths, for the active scenario."""
    return _log("get_street_risk", {"lat": lat, "lon": lon}, hg.street_risk(lat, lon, _sc()))


@tool
def find_dry_parking(lat: float, lon: float) -> dict:
    """Nearest parking places that stay dry in the active scenario (flyovers, multi-storey, open
    ground), with straight-line distance in metres."""
    return _log("find_dry_parking", {"lat": lat, "lon": lon}, hg.dry_parking(lat, lon, _sc()))


@tool
def safe_route(from_lat: float, from_lon: float, to_lat: float, to_lon: float, mode: str = "car") -> dict:
    """Whether a route exists that avoids roads flooded at the storm's peak (car: >30 cm, two_wheeler: >15 cm),
    its length, and the detour compared with the normal route. For the hour-by-hour 'leave by' time,
    point the user to the answer card in the app."""
    out = hg.safe_route((from_lat, from_lon), (to_lat, to_lon), _sc(), mode)
    out = {k: v for k, v in out.items() if k != "safe_edges"}
    return _log("safe_route", {"from": [from_lat, from_lon], "to": [to_lat, to_lon], "mode": mode}, out)


@tool
def hospital_status() -> dict:
    """How many hospitals are cut off from the main road network by flooding in the active scenario."""
    return _log("hospital_status", {}, hg.hospital_status(_sc()))


@tool
def current_forecast() -> dict:
    """Tonight's rainfall forecast (Open-Meteo) and which modelled scenario it maps to."""
    cur = hg.current()
    return _log("current_forecast", {}, {k: cur.get(k) for k in ("updated_at", "start_local", "forecast", "scenario", "note")})


@tool
def model_limits() -> dict:
    """What the HighGround model can and cannot do."""
    return _log("model_limits", {}, {"limits": hg.LIMITS})


NUM = re.compile(r"(?<![\w.])(\d+(?:[.,]\d+)?)")


def grounding(answer: str):
    blob = json.dumps([c["output"] for c in CALLS])
    found = set(NUM.findall(blob))
    ignore = {"112"}
    nums = [n for n in NUM.findall(answer) if n not in ignore]
    return [{"value": n, "grounded": n.replace(",", "") in found or n in found} for n in nums]


def handler(event, context):
    body = json.loads(event.get("body") or "{}")
    q = (body.get("question") or "").strip()[:600]
    if not q:
        return {"statusCode": 400, "body": json.dumps({"error": "Ask a question."})}
    CALLS.clear()
    CTX.clear()
    CTX["scenario"] = body.get("scenario")
    where = ""
    if body.get("lat") is not None:
        where = (f"\n(The user's searched place: {body.get('place') or 'their address'} at "
                 f"lat {body['lat']}, lon {body['lon']}.)")
    if CTX["scenario"] and CTX["scenario"].get("run"):
        where += f"\n(Active scenario: replay '{CTX['scenario'].get('label', CTX['scenario']['run'])}'.)"
    model = BedrockModel(model_id=os.environ["MODEL_ID"], temperature=0.1, max_tokens=500)
    agent = Agent(model=model, system_prompt=SYSTEM, callback_handler=None,
                  tools=[get_street_risk, find_dry_parking, safe_route, hospital_status, current_forecast, model_limits])
    answer = str(agent(q + where)).strip()
    nums = grounding(answer)
    out = {"answer": answer, "numbers": nums, "all_grounded": all(n["grounded"] for n in nums),
           "tools": [{"tool": c["tool"], "input": c["input"]} for c in CALLS], "model": os.environ["MODEL_ID"]}
    return {"statusCode": 200, "headers": {"content-type": "application/json"}, "body": json.dumps(out)}
