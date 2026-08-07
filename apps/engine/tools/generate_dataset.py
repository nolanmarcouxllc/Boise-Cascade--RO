"""
Generate the Westfield, MA synthetic delivery dataset.

Models the real failure mode this tool diagnoses: DMSi Agility releases orders
to logistics in waves; Trimble PC*MILER builds routes from whatever is visible
at dispatch time. Wave-1 trucks (06:30) leave with open flatbed capacity, then
wave-2 orders (09:45) release and get dispatched on separate trucks into the
same towns. The routing math was fine -- the order picture was incomplete.

Baked-in patterns per day:
  - 5-6 consolidation candidate groups (>=15% of loads), 11 on the bad
    Wednesday (2026-07-29): same-customer dupes + geo-cluster dupes, all
    weight-feasible (combined < 48,000 lb legal flatbed payload).
  - Wave-1 members intentionally leave with open capacity (<30k lb routes).
  - Decoys the detector must NOT flag: a legit heavy split (two trucks because
    combined weight > 48k) and a same-truck double (two orders, one truck).
  - Everything else is clean: one truck per zone per day, all cross-truck
    stops > 6.5 mi apart so no accidental clusters at the 6 mi radius.

Deterministic (seeded). Writes apps/engine/data/boise_cascade_deliveries.csv.
"""

import csv
import math
import os
import random
from collections import defaultdict

random.seed(20260806)

ENGINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ENGINE, "data", "boise_cascade_deliveries.csv")

DEPOT = (42.1248, -72.7496)  # 95 Elm Street, Westfield, MA 01085
MAX_LOAD = 48000
RADIUS_GUARD = 6.5  # generator keeps unrelated cross-truck stops beyond this
W1, W2 = "06:30", "09:45"


def miles(a, b):
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    s = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 2 * 3958.7613 * math.asin(math.sqrt(s))


# code, name, street, city, state, zip, lat, lng, zone
CUSTOMERS = [
    # Springfield metro
    ("HOLBROOK", "Holbrook Lumber Co", "627 Page Blvd", "Springfield", "MA", "01104", 42.1121, -72.5605, "springfield"),
    ("84LSPR", "84 Lumber #0421", "340 Taylor St", "Springfield", "MA", "01105", 42.1043, -72.5731, "springfield"),
    ("CHICBS", "Chicopee Building Supply", "92 Meadow St", "Chicopee", "MA", "01013", 42.1615, -72.6039, "springfield"),
    ("WSPRHW", "West Side Builders Supply", "1440 Riverdale St", "West Springfield", "MA", "01089", 42.1281, -72.6412, "springfield"),
    ("HOLYOKE", "Holyoke Millwork & Door", "1 Cabot St", "Holyoke", "MA", "01040", 42.2081, -72.6151, "springfield"),
    ("AGAWAMBS", "Agawam Building Products", "630 Silver St", "Agawam", "MA", "01001", 42.0695, -72.6151, "springfield"),
    ("PALMERBS", "Quaboag Valley Lumber", "1240 Thorndike St", "Palmer", "MA", "01069", 42.1584, -72.3287, "springfield"),
    # Pioneer Valley
    ("VALLEYBS", "Valley Building Supply", "320 King St", "Northampton", "MA", "01060", 42.3389, -72.6417, "pioneer"),
    ("AMHERSTL", "Amherst Lumber", "459 University Dr", "Amherst", "MA", "01002", 42.3672, -72.5312, "pioneer"),
    ("GREENF", "Franklin County Building Supply", "89 French King Hwy", "Greenfield", "MA", "01301", 42.6039, -72.5541, "pioneer"),
    ("SDEERF", "South Deerfield Lumber", "260 Greenfield Rd", "South Deerfield", "MA", "01373", 42.4777, -72.6079, "pioneer"),
    # Berkshires + southern VT (west)
    ("PITTSL", "Pittsfield Lumber & Supply", "555 Dalton Ave", "Pittsfield", "MA", "01201", 42.4520, -73.2380, "berkshire"),
    ("LEEBS", "Lee Building Products", "180 Pleasant St", "Lee", "MA", "01238", 42.3042, -73.2482, "berkshire"),
    ("BENNVT", "Bennington Building Supply", "121 Depot St", "Bennington", "VT", "05201", 42.8795, -73.1925, "berkshire"),
    ("NADAMS", "Mohawk Trail Building Supply", "1420 Curran Hwy", "North Adams", "MA", "01247", 42.7009, -73.1087, "berkshire"),
    # Southern VT (east)
    ("BRATVT", "Brattleboro Home & Lumber", "532 Putney Rd", "Brattleboro", "VT", "05301", 42.8552, -72.5715, "vermont"),
    # Worcester
    ("WORCBS", "Worcester Building Supply", "120 Southbridge St", "Worcester", "MA", "01608", 42.2751, -71.7997, "worcester"),
    ("AUBURNBS", "Auburn Lumber Co", "48 Millbury St", "Auburn", "MA", "01501", 42.1945, -71.8356, "worcester"),
    # Boston metro west
    ("BFSFRAM", "Builders FirstSource Framingham", "350 Irving St", "Framingham", "MA", "01702", 42.2989, -71.4308, "bostonwest"),
    ("NATWOB", "National Lumber Woburn", "245 Salem St", "Woburn", "MA", "01801", 42.4855, -71.1450, "bostonwest"),
    ("MARLBS", "Marlborough Builders Supply", "31 Sasseville Way", "Marlborough", "MA", "01752", 42.3459, -71.5522, "bostonwest"),
    ("NASHOBA", "Nashoba Valley Building Supply", "100 Powder Mill Rd", "Acton", "MA", "01720", 42.4851, -71.4328, "bostonwest"),
    # Hartford
    ("REXHART", "Rex Lumber Hartford", "610 Wethersfield Ave", "Hartford", "CT", "06114", 41.7420, -72.6689, "hartford"),
    ("84LHART", "84 Lumber #0388", "145 Leibert Rd", "Hartford", "CT", "06120", 41.7889, -72.6683, "hartford"),
    ("BFSEHART", "Builders FirstSource East Hartford", "240 Prestige Park Rd", "East Hartford", "CT", "06108", 41.7808, -72.6091, "hartford"),
    ("MANCHBS", "Manchester Building Products", "391 W Middle Tpke", "Manchester", "CT", "06040", 41.7759, -72.5215, "hartford"),
    ("NEWBRIT", "Hardware City Building Supply", "225 Christian Ln", "New Britain", "CT", "06051", 41.6687, -72.7799, "hartford"),
    ("GLASTBS", "Glastonbury Lumber", "39 Commerce St", "Glastonbury", "CT", "06033", 41.7123, -72.6082, "hartford"),
    # Central CT
    ("NELUMB", "Northeast Lumber", "533 S Broad St", "Meriden", "CT", "06450", 41.5462, -72.8112, "centralct"),
    ("WATBS", "Brass City Building Supply", "2100 S Main St", "Waterbury", "CT", "06706", 41.5661, -73.0405, "centralct"),
    ("MIDDBS", "Middlesex Building Products", "440 Newfield St", "Middletown", "CT", "06457", 41.5701, -72.6595, "centralct"),
    ("BRISTBS", "Bristol Building Supply", "895 Farmington Ave", "Bristol", "CT", "06010", 41.6718, -72.9493, "centralct"),
    # New Haven shore
    ("NATNH", "National Lumber New Haven", "20 Lenox St", "New Haven", "CT", "06513", 41.3162, -72.8989, "newhaven"),
    ("ELMCITY", "Elm City Building Products", "480 Grand Ave", "New Haven", "CT", "06511", 41.3055, -72.9104, "newhaven"),
    ("MILFBS", "Milford Building Supply", "85 Rowe Ave", "Milford", "CT", "06461", 41.2301, -73.0640, "newhaven"),
    ("GUILBS", "Shoreline Building Products", "2280 Boston Post Rd", "Guilford", "CT", "06437", 41.2895, -72.6817, "newhaven"),
    # Fairfield County
    ("BPTBS", "Park City Building Products", "480 Iranistan Ave", "Bridgeport", "CT", "06604", 41.1932, -73.2010, "fairfield"),
    ("NORWBS", "Norwalk Lumber & Millwork", "120 Water St", "Norwalk", "CT", "06854", 41.1177, -73.4079, "fairfield"),
    ("DANBS", "Danbury Building Supply", "57 Shelter Rock Rd", "Danbury", "CT", "06810", 41.4015, -73.4501, "fairfield"),
    ("STAMBS", "Stamford Building Materials", "80 Harvard Ave", "Stamford", "CT", "06902", 41.0598, -73.5405, "fairfield"),
    ("RIDGEBS", "Ridgefield Supply Co", "29 Prospect St", "Ridgefield", "CT", "06877", 41.2812, -73.4986, "fairfield"),
    # Eastern CT
    ("NORWICH", "Rose City Lumber", "224 W Main St", "Norwich", "CT", "06360", 41.5320, -72.0801, "easternct"),
    ("NLONBS", "Whaling City Building Supply", "351 Broad St", "New London", "CT", "06320", 41.3502, -72.1023, "easternct"),
    ("WILLIBS", "Windham Building Products", "1548 W Main St", "Willimantic", "CT", "06226", 41.7106, -72.2081, "easternct"),
    # Rhode Island
    ("BFSPROV", "Builders FirstSource Providence", "260 Kinsley Ave", "Providence", "RI", "02903", 41.8221, -71.4302, "rhodeisland"),
    ("OCEANST", "Ocean State Lumber", "45 Dupont Dr", "Providence", "RI", "02907", 41.8005, -71.4506, "rhodeisland"),
    ("WARWBS", "Warwick Building Products", "555 Jefferson Blvd", "Warwick", "RI", "02886", 41.7005, -71.4260, "rhodeisland"),
    ("NKINGBS", "North Kingstown Lumber", "7712 Post Rd", "North Kingstown", "RI", "02852", 41.5801, -71.4774, "rhodeisland"),
    # Capital District NY
    ("BFSALB", "Builders FirstSource Albany", "926 Broadway", "Albany", "NY", "12207", 42.6598, -73.7405, "capitalny"),
    ("CAPDIST", "Capital District Building Supply", "1218 Central Ave", "Albany", "NY", "12205", 42.7105, -73.8202, "capitalny"),
    ("SCHENBS", "Schenectady Lumber", "1680 Chrisler Ave", "Schenectady", "NY", "12303", 42.8025, -73.9401, "capitalny"),
    ("TROYBS", "Collar City Building Supply", "621 River St", "Troy", "NY", "12180", 42.7284, -73.6918, "capitalny"),
    # Hudson Valley
    ("84LPOK", "84 Lumber #1146", "600 Violet Ave", "Poughkeepsie", "NY", "12601", 41.6805, -73.9385, "hudson"),
    ("KINGBS", "Kingston Building Supply", "850 Flatbush Ave", "Kingston", "NY", "12401", 41.9385, -73.9905, "hudson"),
    ("NEWBGH", "Hudson Valley Building Materials", "1220 Route 300", "Newburgh", "NY", "12550", 41.5101, -74.0212, "hudson"),
    ("ORANGEBS", "Orange County Building Supply", "33 Dolson Ave", "Middletown", "NY", "10940", 41.4459, -74.4229, "hudson"),
    # Westchester
    ("WPBS", "Westchester Building Products", "180 Westmoreland Ave", "White Plains", "NY", "10606", 41.0421, -73.7702, "westchester"),
    ("YONKBS", "Yonkers Lumber Co", "1088 Saw Mill River Rd", "Yonkers", "NY", "10710", 40.9385, -73.8905, "westchester"),
    ("NEWROCH", "Sound Shore Building Supply", "379 Main St", "New Rochelle", "NY", "10801", 40.9115, -73.7824, "westchester"),
    # NYC / Long Island
    ("EMPIRE", "Empire Building Materials", "38-20 Review Ave", "Long Island City", "NY", "11101", 40.7402, -73.9312, "nycli"),
    ("QBCS", "Queensboro Construction Supply", "47-15 34th St", "Long Island City", "NY", "11101", 40.7431, -73.9265, "nycli"),
    ("HICKBS", "Hicksville Building Supply", "300 Duffy Ave", "Hicksville", "NY", "11801", 40.7712, -73.5205, "nycli"),
    ("FARMLI", "Long Island Millwork", "48 Allen Blvd", "Farmingdale", "NY", "11735", 40.7305, -73.4485, "nycli"),
    ("BRONXBS", "Hunts Point Building Materials", "740 Barretto St", "Bronx", "NY", "10474", 40.8155, -73.8918, "nycli"),
    # North Jersey
    ("IRONBND", "Ironbound Building Supply", "315 Ferry St", "Newark", "NJ", "07105", 40.7285, -74.1502, "northnj"),
    ("GSMILL", "Garden State Millwork", "480 Frelinghuysen Ave", "Newark", "NJ", "07114", 40.7059, -74.1735, "northnj"),
    ("84LPARS", "84 Lumber #2210", "1159 US-46", "Parsippany", "NJ", "07054", 40.8602, -74.4205, "northnj"),
    ("PATERBS", "Silk City Building Materials", "245 E Railway Ave", "Paterson", "NJ", "07503", 40.9105, -74.1602, "northnj"),
    ("ELIZBS", "Union County Building Supply", "601 Bayway Ave", "Elizabeth", "NJ", "07202", 40.6639, -74.2107, "northnj"),
    # Lehigh Valley / NE PA
    ("ABEBS", "Lehigh Valley Building Supply", "1750 Grammes Rd", "Allentown", "PA", "18103", 40.6084, -75.4900, "lehigh"),
    ("BETHBS", "Bethlehem Building Products", "2260 Industrial Dr", "Bethlehem", "PA", "18017", 40.6301, -75.3652, "lehigh"),
    ("STROUDBS", "Pocono Building Supply", "1204 N 9th St", "Stroudsburg", "PA", "18360", 40.9801, -75.1902, "lehigh"),
    ("SCRANBS", "Scranton Lumber & Supply", "1130 Capouse Ave", "Scranton", "PA", "18509", 41.4102, -75.6605, "lehigh"),
    ("EASTONPA", "Forks of the Delaware Building Supply", "3700 Sullivan Trail", "Easton", "PA", "18040", 40.6884, -75.2207, "lehigh"),
]

CUST = {c[0]: c for c in CUSTOMERS}
ZONES = sorted({c[8] for c in CUSTOMERS})
ZONE_CUSTOMERS = defaultdict(list)
for c in CUSTOMERS:
    ZONE_CUSTOMERS[c[8]].append(c[0])

# One truck per zone per day (wave 1), fixed mapping. Pool trucks = wave 2.
ZONE_TRUCK = {z: f"T-{i + 1:02d}" for i, z in enumerate(ZONES)}
POOL_TRUCKS = [f"T-{i:02d}" for i in range(19, 25)]

ZONE_WEIGHTS = {
    "springfield": 6, "pioneer": 3, "berkshire": 2, "vermont": 1,
    "worcester": 2, "bostonwest": 3, "hartford": 6, "centralct": 4,
    "newhaven": 4, "fairfield": 4, "easternct": 2, "rhodeisland": 3,
    "capitalny": 3, "hudson": 3, "westchester": 3, "nycli": 4,
    "northnj": 4, "lehigh": 3,
}

GEO_PAIRS = [
    ("HOLBROOK", "84LSPR"), ("REXHART", "84LHART"), ("NATNH", "ELMCITY"),
    ("BFSPROV", "OCEANST"), ("EMPIRE", "QBCS"), ("IRONBND", "GSMILL"),
    ("BFSALB", "CAPDIST"),
]

SAME_POOL = [
    "BFSEHART", "WATBS", "HICKBS", "ABEBS", "BFSFRAM", "84LPOK", "BPTBS",
    "WARWBS", "MANCHBS", "FARMLI", "PATERBS", "DANBS", "NEWBGH", "WPBS",
    "NATWOB", "NELUMB", "STAMBS", "SCRANBS", "VALLEYBS", "MILFBS", "84LPARS",
    "HOLBROOK", "EMPIRE", "WORCBS", "KINGBS", "NORWICH",
]
DECOY_POOL = ["NATWOB", "BFSFRAM", "EMPIRE", "IRONBND", "BFSALB", "BFSPROV", "HICKBS", "ABEBS", "WPBS", "REXHART"]
DOUBLE_POOL = ["CHICBS", "MANCHBS", "MIDDBS", "GUILBS", "NORWBS", "WARWBS", "SCHENBS", "KINGBS", "YONKBS", "FARMLI", "PATERBS", "BETHBS"]

DATES = [
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24",
    "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
]
BAD_DAY = "2026-07-29"
GROUPS_PER_DAY = {d: (11 if d == BAD_DAY else n) for d, n in zip(DATES, [5, 6, 5, 5, 6, 5, 5, 11, 5, 6])}
GEO_PER_DAY = {d: (5 if d == BAD_DAY else 2) for d in DATES}

PRODUCTS = [
    ("OSB 7/16 4x8 sheathing", 2450, "pallets"),
    ("CDX plywood 1/2 4x8", 2300, "pallets"),
    ("SPF dimensional lumber 2x4-2x10", 2.35, "BF"),
    ("LVL 1.75x11.875 beams", 95, "pcs"),
    ("BCI I-joists 11.875", 62, "pcs"),
    ("James Hardie lap siding", 2900, "pallets"),
    ("CertainTeed vinyl siding", 1450, "pallets"),
    ("Trex composite decking", 2250, "pallets"),
    ("Millwork & interior trim", 1800, "bundles"),
]


def product_for(weight):
    name, unit_w, unit = random.choice(PRODUCTS)
    if unit == "BF":
        n = int(weight / unit_w / 100) * 100
        return name, f"{n:,} BF"
    n = max(1, round(weight / unit_w))
    return name, f"{n} {unit}"


def latlng(code):
    c = CUST[code]
    return (c[6], c[7])


def validate_geography():
    """No two customers in different zones may sit within the guard radius."""
    for i, a in enumerate(CUSTOMERS):
        for b in CUSTOMERS[i + 1:]:
            if a[8] != b[8]:
                d = miles((a[6], a[7]), (b[6], b[7]))
                assert d > RADIUS_GUARD, f"cross-zone too close: {a[0]}–{b[0]} = {d:.1f} mi"
    for a, b in GEO_PAIRS:
        d = miles(latlng(a), latlng(b))
        assert d <= 5.5, f"geo pair too far apart: {a}–{b} = {d:.1f} mi"


class Day:
    def __init__(self, date):
        self.date = date
        self.rows = []            # dicts
        self.truck_w = defaultdict(int)
        self.truck_n = defaultdict(int)
        self.truck_closed = set()
        self.stops = []           # (lat, lng, truck)
        self.hot_points = []      # (lat, lng) of candidate/decoy stops
        self.hot_customers = set()
        self.pool_i = 0

    def next_pool(self, weight):
        for _ in range(len(POOL_TRUCKS)):
            t = POOL_TRUCKS[self.pool_i % len(POOL_TRUCKS)]
            self.pool_i += 1
            if self.truck_n[t] < 3 and self.truck_w[t] + weight <= MAX_LOAD:
                return t
        raise RuntimeError("pool trucks exhausted")

    def add(self, code, truck, weight, window, hot=False):
        c = CUST[code]
        prod, units = product_for(weight)
        self.rows.append({
            "delivery_date": self.date, "dispatch_window": window,
            "customer_id": code, "customer_name": c[1], "address": c[2],
            "city": c[3], "state": c[4], "zip": c[5], "truck_id": truck,
            "product": prod, "units": units, "weight_lbs": weight,
            "lat": c[6], "lng": c[7],
        })
        self.truck_w[truck] += weight
        self.truck_n[truck] += 1
        self.stops.append((c[6], c[7], truck))
        if hot:
            self.hot_points.append((c[6], c[7]))
            self.hot_customers.add(code)

    def clean_ok(self, code, truck):
        p = latlng(code)
        for hp in self.hot_points:
            if miles(p, hp) <= RADIUS_GUARD:
                return False
        for (lat, lng, t) in self.stops:
            if t != truck and miles(p, (lat, lng)) <= RADIUS_GUARD:
                return False
        return True


def build_day(date, rot):
    day = Day(date)
    n_groups = GROUPS_PER_DAY[date]
    n_geo = GEO_PER_DAY[date]
    n_same = n_groups - n_geo
    used_zones = set()
    stats = {"groups": 0, "cand_loads": 0}

    # --- geo-cluster candidates -------------------------------------------
    picked = 0
    while picked < n_geo:
        a, b = GEO_PAIRS[rot["geo"] % len(GEO_PAIRS)]
        rot["geo"] += 1
        z = CUST[a][8]
        if z in used_zones:
            continue
        used_zones.add(z)
        zt = ZONE_TRUCK[z]
        w1 = random.randint(16000, 24000)
        w2 = random.randint(6000, 12000)
        day.add(a, zt, w1, W1, hot=True)
        day.add(b, day.next_pool(w2), w2, W2, hot=True)
        # zone truck leaves room so the wave-2 order could have ridden along
        day.truck_closed.discard(zt)
        day.truck_w[zt] = day.truck_w[zt]  # budget enforced via cap below
        day.truck_budget = getattr(day, "truck_budget", {})
        day.truck_budget[zt] = MAX_LOAD - (w1 + w2)
        picked += 1
        stats["groups"] += 1
        stats["cand_loads"] += 2

    # --- same-customer candidates -----------------------------------------
    picked = 0
    triple_done = False
    while picked < n_same:
        code = SAME_POOL[rot["same"] % len(SAME_POOL)]
        rot["same"] += 1
        z = CUST[code][8]
        if z in used_zones or code in day.hot_customers:
            continue
        used_zones.add(z)
        zt = ZONE_TRUCK[z]
        if date == BAD_DAY and not triple_done:
            wts = [random.randint(13000, 16000), random.randint(8000, 12000), random.randint(7000, 10000)]
            day.add(code, zt, wts[0], W1, hot=True)
            day.add(code, day.next_pool(wts[1]), wts[1], W2, hot=True)
            day.add(code, day.next_pool(wts[2]), wts[2], W2, hot=True)
            total = sum(wts)
            stats["cand_loads"] += 3
            triple_done = True
        else:
            w1 = random.randint(18000, 26000)
            w2 = random.randint(6000, 14000)
            day.add(code, zt, w1, W1, hot=True)
            day.add(code, day.next_pool(w2), w2, W2, hot=True)
            total = w1 + w2
            stats["cand_loads"] += 2
        assert total <= 40000
        day.truck_budget = getattr(day, "truck_budget", {})
        day.truck_budget[zt] = MAX_LOAD - total
        picked += 1
        stats["groups"] += 1

    # --- decoy: legit heavy split (combined > 44k -> must NOT be flagged) ---
    while True:
        code = DECOY_POOL[rot["decoy"] % len(DECOY_POOL)]
        rot["decoy"] += 1
        z = CUST[code][8]
        if z not in used_zones and code not in day.hot_customers:
            used_zones.add(z)
            zt = ZONE_TRUCK[z]
            wa, wb = random.randint(35500, 38500), random.randint(35500, 38500)
            day.add(code, zt, wa, W1, hot=True)
            # A ~38k second load realistically gets its own dedicated truck.
            day.add(code, "T-25", wb, W2, hot=True)
            day.truck_closed.add(zt)
            break

    # --- decoy: same-truck double (one truck, two orders -> not flagged) ----
    while True:
        code = DOUBLE_POOL[rot["double"] % len(DOUBLE_POOL)]
        rot["double"] += 1
        z = CUST[code][8]
        if z not in used_zones and code not in day.hot_customers:
            used_zones.add(z)
            zt = ZONE_TRUCK[z]
            day.add(code, zt, random.randint(8000, 11000), W1, hot=True)
            day.add(code, zt, random.randint(6000, 9000), W2, hot=True)
            break

    # --- clean fill to 60 loads --------------------------------------------
    # A customer may receive up to 2 clean orders/day but only on the SAME
    # truck (two orders on one route = normal ops, never a candidate).
    cust_count = defaultdict(int)
    cust_truck = {}
    for c in day.hot_customers:
        cust_count[c] = 99  # candidates/decoys: no additional clean stops
    budget = getattr(day, "truck_budget", {})
    zones_list = list(ZONE_WEIGHTS.keys())
    weights = [ZONE_WEIGHTS[z] for z in zones_list]
    attempts = 0
    while len(day.rows) < 60:
        attempts += 1
        if attempts > 30000:
            raise RuntimeError(f"{date}: filler starved at {len(day.rows)} loads")
        z = random.choices(zones_list, weights)[0]
        truck = ZONE_TRUCK[z]
        # Last resort on heavy candidate days: wave-2 pool trucks absorb
        # remaining clean orders (distance checks still enforced below).
        if attempts > 12000:
            alt = [t for t in POOL_TRUCKS
                   if t not in day.truck_closed and day.truck_n[t] < 8
                   and MAX_LOAD - day.truck_w[t] >= 3000]
            if alt:
                truck = random.choice(alt)
        if truck in day.truck_closed or day.truck_n[truck] >= 8:
            continue
        cap = budget.get(truck, MAX_LOAD)
        remaining = cap - day.truck_w[truck] if truck in budget else MAX_LOAD - day.truck_w[truck]
        if remaining < 3000:
            day.truck_closed.add(truck)
            continue
        avail = [
            c for c in ZONE_CUSTOMERS[z]
            if cust_count[c] < 3
            and (cust_count[c] == 0 or cust_truck.get(c) == truck)
            and day.clean_ok(c, truck)
        ]
        if not avail:
            continue
        code = random.choice(avail)
        if day.truck_n[truck] == 0 and truck not in budget and random.random() < 0.12:
            w = random.randint(36000, 43500)  # solo full flatbed
            day.add(code, truck, w, W1)
            day.truck_closed.add(truck)
        else:
            hi = min(15500, remaining)
            if hi < 3000: continue
            w = random.randint(3000, hi)
            if truck in POOL_TRUCKS:
                win = W2  # pool trucks are the second dispatch by definition
            else:
                win = W1 if random.random() < 0.85 else W2
            day.add(code, truck, w, win)
        cust_count[code] += 1
        cust_truck[code] = truck

    # legality check: every truck-day route <= 44k
    for t, w in day.truck_w.items():
        assert w <= MAX_LOAD, f"{date} {t} over legal payload: {w}"
    stats["loads"] = len(day.rows)
    stats["trucks"] = len(day.truck_w)
    return day, stats


def main():
    validate_geography()
    rot = {"geo": 0, "same": 0, "decoy": 0, "double": 0}
    all_rows = []
    so = 728400
    print(f"{'date':<12} {'loads':>5} {'groups':>6} {'cand loads':>10} {'trucks':>6}")
    total_groups = 0
    for d in DATES:
        day, stats = build_day(d, rot)
        # order ids: wave 1 first, then wave 2 (later DMSi release = higher SO#)
        day.rows.sort(key=lambda r: (r["dispatch_window"], r["truck_id"]))
        for r in day.rows:
            r["order_id"] = f"SO-{so}"
            so += random.randint(1, 4)
        all_rows.extend(day.rows)
        total_groups += stats["groups"]
        print(f"{d:<12} {stats['loads']:>5} {stats['groups']:>6} {stats['cand_loads']:>10} {stats['trucks']:>6}")

    cols = ["order_id", "delivery_date", "dispatch_window", "customer_id",
            "customer_name", "address", "city", "state", "zip", "truck_id",
            "product", "units", "weight_lbs", "lat", "lng"]
    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in all_rows:
            w.writerow(r)

    print(f"\nwrote {len(all_rows)} rows -> {OUT}")
    print(f"expected consolidation groups: {total_groups} "
          f"(decoys excluded: heavy-splits and same-truck doubles must NOT be flagged)")


if __name__ == "__main__":
    main()
