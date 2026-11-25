import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../experiments/moon-map/astronotes-routes.js", import.meta.url), "utf8"), context);
const { operationFor, operationStatus } = context.AstroNotesRoutes;
const at = (time) => `2026-11-24T${time}+09:00`;

test("deep-night hours use the night preferential runways and sea arrivals, never the daytime model", () => {
  const RT = context.AstroNotesRoutes;
  for (const time of ["00:00:00", "05:59:59", "23:00:00", "23:59:59"]) {
    const status = operationStatus(at(time));
    assert.equal(status.supported, true, time);
    assert.equal(status.period, "night", time);
    assert.equal(status.northWindow, null);
    assert.equal(status.southWindow, null);
  }
  assert.equal(operationStatus(at("06:00:00")).period, "day");
  assert.equal(operationStatus(at("22:59:59")).period, "day");
  // 23-6 JST is the sea route (MLIT ntrack "海上経路飛行中"): land 34L or 34R (ILS Y) / 23 (LDA Y), take off 05 / 16L.
  for (const hour of [23, 0, 5]) {
    assert.equal(operationFor(340, 5, hour), "nonN");
    assert.equal(operationFor(160, 6, hour), "nonS");
  }
  assert.equal(RT.OPERATIONS.nonN.landing.join(), "34L,34R");
  assert.equal(RT.OPERATIONS.nonN.takeoff.join(), "05");
  assert.equal(RT.OPERATIONS.nonS.landing.join(), "23");
  assert.equal(RT.OPERATIONS.nonS.takeoff.join(), "16L");
  assert.equal(RT.operationChoice("dnfi1", 1), "nonN");
  assert.equal(RT.operationChoice("dsfo1", 23), "nonS");
  assert.equal(RT.operationChoice("dnfi1", 12), "dnfi1");
  assert.equal(RT.operationChoice("nonS", 16), "dsfi2");
  assert.match(RT.procedureSource("landing", "23@night"), /LDA Y RWY23/);
  // Night arrivals come in over the sea from KAIHO and are not the daytime routes.
  for (const r of ["34R", "34L", "23"]) {
    const night = RT.procedureApproachPath(`${r}@night`), day = RT.procedureApproachPath(r);
    assert.ok(night && day && night.length > 20);
    assert.match(RT.procedureSource("landing", `${r}@night`), /NIGHT/);
    const near = (lat, lon) => night.some((p) => Math.abs(p.latitude - lat) < 0.01 && Math.abs(p.longitude - lon) < 0.01);
    assert.ok(near(35.31606, 139.77844), `${r} night passes KAIHO`);
    const end = night.at(-1);
    assert.ok(Math.abs(end.latitude - 34.94639) < 0.01 && Math.abs(end.longitude - 139.89553) < 0.01, `${r} night starts at UTIBO`);
    assert.notEqual(JSON.stringify(night.at(-1)), JSON.stringify(day.at(-1)));
  }
});

test("published north and south time windows have exact half-hour boundaries", () => {
  const cases = [
    ["06:59:59", "existing", "existing"], ["07:00:00", "new", "existing"],
    ["11:29:59", "new", "existing"], ["11:30:00", "existing", "existing"],
    ["14:59:59", "existing", "existing"], ["15:00:00", "new", "new"],
    ["18:59:59", "new", "new"], ["19:00:00", "existing", "existing"],
  ];
  for (const [time, north, south] of cases) {
    const status = operationStatus(at(time));
    assert.equal(status.northWindow, north, time);
    assert.equal(status.southWindow, south, time);
    assert.equal(status.operationConfirmed, false);
  }
});

test("JST is derived from the instant, including Date objects from other realms", () => {
  const input = "2026-11-24T06:00:00Z";
  for (const value of [input, Date.parse(input), new Date(input), "2026-11-24T01:00:00-05:00"]) {
    const status = operationStatus(value);
    assert.equal(status.hourJst, 15);
    assert.equal(status.timeZone, "Asia/Tokyo");
    assert.equal(status.southWindow, "new");
  }
});

test("missing, invalid, or timezone-ambiguous time stays unsupported", () => {
  for (const value of [undefined, null, "", "invalid", "2026-11-24T15:00", NaN, Infinity, new Date(NaN), {}]) {
    const status = operationStatus(value);
    assert.equal(status.supported, false, String(value));
    assert.equal(status.period, "unknown");
    assert.equal(status.hourJst, null);
  }
});

test("bad or missing wind cannot silently select north or south", () => {
  for (const direction of [null, undefined, NaN, Infinity, "180", -1, 361]) assert.equal(operationFor(direction, 5, 16), null);
  for (const speed of [null, NaN, Infinity, "5", -0.1]) assert.equal(operationFor(150, speed, 16), null);
  for (const hour of [null, NaN, Infinity, "16", -1, 24]) assert.equal(operationFor(150, 5, hour), null);
});

test("existing wind-model choices remain estimates and keep optional-argument behavior", () => {
  // Keys are the MLIT ntrack classes: d + n/s (wind) + fi/fo (fine / not fine) + 1/2 (usual / new route hours).
  assert.equal(operationFor(330, 5, 16), "dnfi2");
  assert.equal(operationFor(330, 5, 12), "dnfi1");
  assert.equal(operationFor(330, 5, 8), "dnfi2");
  assert.equal(operationFor(330, 5, 11.5), "dnfi1");
  assert.equal(operationFor(360, 5, 16, { fine: false }), "dnfo2");
  assert.equal(operationFor(150, 5, 14.99), "dsfi1");
  assert.equal(operationFor(150, 5, 15), "dsfi2");
  assert.equal(operationFor(150, 5, 18), "dsfi1");
  assert.equal(operationFor(150, 5, 15, { fine: false }), "dsfo2");
  assert.equal(operationFor(150, 5, 12, { fine: false }), "dsfo1");
  assert.equal(operationFor(150), "dsfi1");
  assert.equal(operationFor(150, 0, 16), "dnfi2");
  assert.equal(operationFor(150, 2.6, 16), "dnfi2");
  assert.equal(operationFor(150, 2.61, 16), "dsfi2");
  // The south new route lands 16L/16R and takes off 22/16R (ntrack), not 22/16L.
  assert.equal(context.AstroNotesRoutes.OPERATIONS.dsfi2.takeoff.join(), "22,16R");
});

test("arrivals and departures follow the published procedures as smooth flown curves", () => {
  const RT = context.AstroNotesRoutes;
  const DEG = Math.PI / 180, FT = 0.3048;
  const km = (a, b) => { const r = DEG, x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(x)); };
  const bearing = (a, b) => Math.atan2((b.longitude - a.longitude) * Math.cos(35.55 * DEG), b.latitude - a.latitude) / DEG;
  const turnPerKm = (path) => { let worst = 0; for (let i = 2; i < path.length; i++) {
    const d = Math.abs(((bearing(path[i - 1], path[i]) - bearing(path[i - 2], path[i - 1])) + 540) % 360 - 180);
    const step = km([path[i - 1].latitude, path[i - 1].longitude], [path[i].latitude, path[i].longitude]);
    if (step > 0.02) worst = Math.max(worst, d / step); } return worst; };
  // FAF of each published approach (AIP RJTT AD2.24 IAC): the final is straight from the threshold to here
  const faf = { "16L": [35.69578, 139.69418], "16R": [35.70354, 139.66686], "34L": [35.32203, 139.93744], "34R": [35.37022, 139.92503], "23": [35.6814, 139.99165] };
  for (const ident of ["16L", "16R", "34L", "34R", "22", "23"]) {
    const path = RT.procedureApproachPath(ident), rw = RT.runwayOf(ident), m = RT.PROCEDURES.arrival[ident];
    const t = rw.landingThreshold ?? rw.threshold;
    assert.ok(km([path[0].latitude, path[0].longitude], [t.latitude, t.longitude]) < 0.001, ident + " starts at the landing threshold");
    assert.ok(Math.abs(path[0].altitudeM - rw.elevationM - RT.THRESHOLD_CROSSING_M) < 0.01);
    for (let i = 1; i < path.length; i++) {
      assert.ok(path[i].distanceKm > path[i - 1].distanceKm, "along distance increases");
      assert.ok(path[i].distanceKm - path[i - 1].distanceKm <= 0.5 + 1e-9, "no gap over 0.5 km");
      assert.ok(path[i].altitudeM >= path[i - 1].altitudeM - 1e-9, ident + " arrival altitude rises outward");
    }
    // No kinks: a 2 km turn radius bends at most ~29°/km; allow sampling slack
    assert.ok(turnPerKm(path) < 40, ident + " has no sharp corner: " + turnPerKm(path).toFixed(1));
    if (faf[ident]) {
      const hit = path.find((p) => km([p.latitude, p.longitude], faf[ident]) < 0.01);
      assert.ok(hit, ident + " passes the FAF on the straight final");
      assert.ok(Math.abs(hit.altitudeM - rw.elevationM - RT.THRESHOLD_CROSSING_M - hit.distanceKm * 1000 * Math.tan(m.glideDeg * DEG)) < 1, ident + " glide");
      const final = path.filter((p) => p.distanceKm <= hit.distanceKm);
      for (const p of final.slice(1)) assert.ok(Math.abs(((bearing(path[0], p) - bearing(path[0], hit)) + 540) % 360 - 180) < 0.2, ident + " final is straight");
    }
    // Every published fix with an altitude is passed nearby (fly-by turns cut inside) at that altitude
    const end = m.cut ? m.fixes.findIndex((f) => f[0] === m.cut) : m.fixes.length - 1;
    for (const [name, lat, lon, ft] of m.fixes.slice(0, end + 1)) {
      const near = path.reduce((b, p) => { const d = km([p.latitude, p.longitude], [lat, lon]); return d < b.d ? { d, p } : b; }, { d: Infinity });
      assert.ok(near.d < 1.5, ident + " passes " + name + " (" + near.d.toFixed(2) + " km)");
      if (Number.isFinite(ft)) assert.ok(Math.abs(near.p.altitudeM - ft * FT) < 60, name + " altitude");
    }
    assert.match(RT.procedureSource("landing", ident), /^AIP RJTT IAC .*STAR/);
    assert.equal(RT.measuredApproachPath(ident).length, path.length);
  }
  // 22 (LDA): only the last 1.8 NM is aligned with the runway
  const p22 = RT.procedureApproachPath("22"), rw22 = RT.runwayOf("22");
  for (const p of p22.filter((p) => p.distanceKm > 0.1 && p.distanceKm <= 1.8 * 1.852))
    assert.ok(Math.abs(((bearing(p, p22[0]) - rw22.headingDegT) + 540) % 360 - 180) < 0.3);
  // Landings aim at the displaced thresholds published in AIP AD2.12, not the runway ends.
  const p16L = RT.approachPath("16L", { fromKm: 0, toKm: 0 })[0];
  assert.ok(km([p16L.latitude, p16L.longitude], [35.562853, 139.788706]) < 0.001);
  assert.ok(RT.procedureApproachPath("16L").at(-1).longitude > 140, "16L comes in from the Chiba side");
  for (const ident of ["04", "05"]) assert.equal(RT.procedureApproachPath(ident), null);

  for (const ident of ["05", "34R", "22", "16L", "16R"]) {
    const path = RT.procedureDeparturePath(ident), rw = RT.runwayOf(ident), m = RT.PROCEDURES.departure[ident];
    const straight = RT.departurePath(ident, { fromKm: 1, toKm: 1 })[0];
    assert.ok(km([path[0].latitude, path[0].longitude], [straight.latitude, straight.longitude]) < 0.001, ident + " lifts off on the runway line");
    const va = path.find((p) => p.altitudeM >= rw.elevationM + m.vaFt * FT);
    for (const p of path.filter((p) => p.distanceKm <= va.distanceKm)) assert.ok(Math.abs(((bearing(path[0], p) - rw.headingDegT) + 540) % 360 - 180) < 0.5 || p === path[0], ident + " climbs straight to " + m.vaFt + " ft");
    for (let i = 1; i < path.length; i++) assert.ok(path[i].altitudeM >= path[i - 1].altitudeM - 1e-9 && path[i].distanceKm > path[i - 1].distanceKm);
    assert.ok(turnPerKm(path) < 45, ident + " departure has no sharp corner");
    for (const [name, lat, lon, ft] of m.fixes) {
      const near = path.reduce((b, p) => { const d = km([p.latitude, p.longitude], [lat, lon]); return d < b.d ? { d, p } : b; }, { d: Infinity });
      assert.ok(near.d < 1.5, ident + " departure passes " + name);
      if (Number.isFinite(ft)) assert.ok(near.p.altitudeM >= ft * FT - 60, name + " at or above " + ft);
    }
    assert.match(RT.procedureSource("takeoff", ident), /^AIP RJTT SID /);
  }
  assert.equal(RT.procedureDeparturePath("34L"), null);
  // Runway 05/23 is one line: 05 points opposite 23 (was 57°, off by 14°)
  assert.ok(Math.abs(RT.runwayOf("05").headingDegT - (RT.runwayOf("23").headingDegT - 180)) < 1);
});

test("every listed airport has consistent runways, two wind directions and straight routes", () => {
  const RT = context.AstroNotesRoutes;
  assert.ok(RT.AIRPORTS.length >= 90, "domestic airports from AIP AD2");
  const ids = new Set();
  for (const a of RT.AIRPORTS) {
    assert.ok(/^R[JO][A-Z]{2}$/.test(a.id) && !ids.has(a.id), a.id); ids.add(a.id);
    assert.ok(a.name && a.shortName && a.runways.length >= 2, a.id);
    for (const r of a.runways) {
      // Each end looks along its heading at the opposite end (runway 300 m–5 km long).
      const n = (Number(r.ident.slice(0, 2)) + 17) % 36 + 1, other = a.runways.find((o) => o.ident === String(n).padStart(2, "0") + ({ L: "R", R: "L", C: "C" }[r.ident.slice(2)] || ""));
      assert.ok(other, `${a.id} ${r.ident} reciprocal`);
      const p = RT.destination(r.threshold.latitude, r.threshold.longitude, r.headingDegT, 1);
      const d0 = Math.hypot(other.threshold.latitude - r.threshold.latitude, (other.threshold.longitude - r.threshold.longitude) * Math.cos(r.threshold.latitude * Math.PI / 180));
      const d1 = Math.hypot(other.threshold.latitude - p.latitude, (other.threshold.longitude - p.longitude) * Math.cos(r.threshold.latitude * Math.PI / 180));
      assert.ok(d1 < d0 && d0 * 111 > 0.3 && d0 * 111 < 5, `${a.id} ${r.ident} geometry`);
    }
    assert.ok(RT.selectAirport(a.id));
    const ops = Object.values(RT.OPERATIONS);
    assert.ok(ops.length >= 2 && ops.every((o) => o.landing.length && o.takeoff.length), `${a.id} operations`);
    for (const wind of [0, 90, 180, 270]) assert.ok(RT.OPERATIONS[RT.operationFor(wind, 5, 12)], `${a.id} wind ${wind}`);
    const o = ops[0], path = RT.approachPath(o.landing[0]);
    assert.ok(path.length > 10 && path[1].altitudeM > path[0].altitudeM, `${a.id} approach`);
    assert.ok(RT.departurePath(o.takeoff[0]).length > 5, `${a.id} departure`);
  }
  // Landing into the wind: a north wind at Kushiro uses runway 35.
  RT.selectAirport("RJCK"); assert.equal(RT.OPERATIONS[RT.operationFor(350, 5, 12)].landing.join(), "35");
  assert.equal(RT.nearestAirport(34.7739, 135.4458).airport.id, "RJOO");
  // Main airports are chosen unless one stands right at a small airfield: Nerima picks Haneda, not Chofu.
  assert.equal(RT.airportFor(35.7356, 139.6517).airport.id, "RJTT");
  assert.equal(RT.airportFor(35.6703, 139.5281).airport.id, "RJTF");
  assert.equal(RT.airportFor(34.7739, 135.4458).airport.id, "RJOO");
  assert.equal(RT.airportFor(42.985, 144.38).airport.id, "RJCK");
  // Haneda keeps its published procedures and operations after switching back.
  RT.selectAirport("RJTT");
  assert.equal(Object.keys(RT.OPERATIONS).join(), "dnfi1,dnfo1,dnfi2,dnfo2,dsfi1,dsfo1,dsfi2,dsfo2,nonN,nonS");
  assert.ok(RT.procedureApproachPath("16L").length > 20);
  assert.equal(RT.AIRPORT.id, "RJTT");
});

test("published procedures read from the AIP give continuous, climbing routes at most airports", () => {
  const RT = context.AstroNotesRoutes;
  let ends = 0, arrivals = 0, departures = 0;
  for (const a of RT.AIRPORTS) {
    RT.selectAirport(a.id);
    for (const r of a.runways) {
      ends++;
      const t = r.landingThreshold ?? r.threshold;
      const arr = RT.procedureApproachPath(r.ident);
      if (arr) {
        arrivals++;
        assert.ok(Math.abs(arr[0].latitude - t.latitude) < 1e-4 && Math.abs(arr[0].longitude - t.longitude) < 1e-4, `${a.id} ${r.ident} starts at the threshold`);
        for (let i = 1; i < arr.length; i++) {
          assert.ok(arr[i].altitudeM >= arr[i - 1].altitudeM - 1e-6, `${a.id} ${r.ident} arrival climbs outward`);
          assert.ok(arr[i].distanceKm - arr[i - 1].distanceKm < 0.6, `${a.id} ${r.ident} arrival is continuous`);
        }
        assert.ok(RT.procedureSource("landing", r.ident).startsWith(`AIP ${a.id} IAC`));
      }
      const dep = RT.procedureDeparturePath(r.ident);
      if (dep) {
        departures++;
        for (let i = 1; i < dep.length; i++) assert.ok(dep[i].altitudeM >= dep[i - 1].altitudeM - 1e-6 && dep[i].distanceKm - dep[i - 1].distanceKm < 0.6, `${a.id} ${r.ident} departure`);
        assert.ok(RT.procedureSource("takeoff", r.ident).startsWith(`AIP ${a.id} SID`));
      }
    }
  }
  assert.ok(arrivals >= 110 && departures >= 110, JSON.stringify({ ends, arrivals, departures }));
  RT.selectAirport("RJTT");
});
