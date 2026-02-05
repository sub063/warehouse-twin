# sim_step2.py
import time
import random
import ast
from dataclasses import dataclass

import pandas as pd
import numpy as np
import simpy
import networkx as nx
from networkx.algorithms.approximation import greedy_tsp

from layout import build_layout_graph


def _parse_slot(x):
    """
    Safely parse a slot like '(4, 3)' into a tuple (4,3).
    Accepts tuple already, or string tuple.
    Returns None if invalid.
    """
    if isinstance(x, tuple) and len(x) == 2:
        return x
    if isinstance(x, str):
        try:
            t = ast.literal_eval(x)
            if isinstance(t, tuple) and len(t) == 2:
                return t
        except Exception:
            return None
    return None


def _lognormal_params(mean, std):
    # Convert desired mean/std to lognormal mu/sigma
    mu = np.log((mean**2) / np.sqrt(std**2 + mean**2))
    sigma = np.sqrt(np.log(1 + (std**2) / (mean**2)))
    return mu, sigma


def run_warehouse_sim(params, orders_df=None):
    """
    Warehouse picking simulation:
      - optional Poisson arrivals
      - batch picking tours
      - TSP-ish route (greedy_tsp) over picked locations + depot
      - walking time from shortest-path distance / walking_speed
      - fixed or lognormal pick time
      - optional breaks + downtime
      - safety: filters any sku_slot not in current layout graph (prevents KeyError)

    Returns: (summary_dict, details_dict)
    """

    # ----------------------------
    # 0) Load orders
    # ----------------------------
    if orders_df is None:
        orders_df = pd.read_csv("orders.csv", dtype={"sku_slot": str})

    orders_df = orders_df.copy()

    # ----------------------------
    # 1) Build layout and distance map
    # ----------------------------
    G, _ = build_layout_graph(
        n_aisles=params["num_aisles"],
        bays_per_aisle=params["bays_per_aisle"],
        cross_aisle_frequency=params["cross_aisle_frequency"],
    )
    valid_nodes = set(G.nodes())

    # Parse sku_slot safely + filter invalid nodes
    orders_df["__slot"] = orders_df["sku_slot"].apply(_parse_slot)
    orders_df = orders_df[orders_df["__slot"].isin(valid_nodes)].copy()
    orders_df.drop(columns="__slot", inplace=True)

    # If no valid picks remain, return gracefully
    if orders_df.empty:
        summary = {
            "batch_size": params.get("batch_size", 0),
            "num_pickers": params.get("num_pickers", 0),
            "throughput": 0,
            "total_distance": 0.0,
            "avg_cycle_time": 0.0,
            "avg_wait_time": 0.0,
            "utilization": 0.0,
            "simulation_time_s": 0.0,
            "note": "No valid sku_slot locations for this layout. Increase aisles/bays or regenerate orders.csv.",
        }
        details = {"cycle_times": [], "throughput_timeline": [], "picker_paths": []}
        return summary, details

    # Precompute shortest path distances (fast lookup)
    dist = dict(nx.all_pairs_dijkstra_path_length(G, weight="weight"))

    # ----------------------------
    # 2) Pick-time distribution setup
    # ----------------------------
    pick_dist = (params.get("pick_time_dist") or "fixed").lower()
    pick_time_fixed = float(params.get("pick_time") or 0.0)

    if pick_dist == "lognormal":
        m = float(params.get("pick_time_mean") or 30.0)
        s = float(params.get("pick_time_std") or 5.0)
        mu, sigma = _lognormal_params(m, s)
    else:
        mu = sigma = None

    # ----------------------------
    # 3) KPI containers
    # ----------------------------
    kpis = {
        "orders_completed": 0,
        "total_distance": 0.0,
        "picker_wait_times": [],
        "order_cycle_times": [],
        "picker_busy_time": 0.0,
        "throughput_timeline": [],
    }
    picker_paths = []

    # Optional slowdown factor (dashboard passes congestion_slowdown)
    congestion_slowdown = float(params.get("congestion_slowdown", 0.0))
    if congestion_slowdown < 0:
        congestion_slowdown = 0.0

    def effective_walk_speed():
        """
        Optional: make walking slower when you have more pickers (simple congestion model).
        speed = base / (1 + slowdown*(pickers-1))
        """
        base = float(params.get("walking_speed") or 1.5)
        n = int(params.get("num_pickers") or 1)
        denom = 1.0 + congestion_slowdown * max(0, n - 1)
        return max(0.1, base / denom)

    depot = params.get("depot_location", (0, 0))
    depot = depot if depot in valid_nodes else (0, 0)

    # ----------------------------
    # 4) Picker process
    # ----------------------------
    def picker(env, batch_rows, arrival_time):
        start_work = env.now
        last_break = env.now
        current = depot

        # Parse & unique visit set (safe)
        slots = []
        for s in batch_rows["sku_slot"].tolist():
            t = _parse_slot(s)
            if t in valid_nodes:
                slots.append(t)
        to_visit = set(slots)

        # If nothing to visit, complete immediately
        if not to_visit:
            completion = env.now
            count_orders = batch_rows["order_id"].nunique()
            kpis["orders_completed"] += count_orders
            kpis["order_cycle_times"].extend([completion - arrival_time] * count_orders)
            return

        # Build a complete graph K over depot + to_visit with weights from dist
        nodes = [depot] + list(to_visit)
        K = nx.Graph()
        K.add_nodes_from(nodes)

        # Faster than nested loops on full nodes: build all pairs once
        for i in range(len(nodes)):
            u = nodes[i]
            du = dist.get(u, {})
            for j in range(i + 1, len(nodes)):
                v = nodes[j]
                w = du.get(v)
                if w is not None:
                    K.add_edge(u, v, weight=w)

        # If graph disconnected for some reason, fall back to simple nearest-neighbor stepping
        try:
            route = greedy_tsp(K, source=depot, weight="weight")
        except Exception:
            route = [depot] + list(to_visit) + [depot]

        if route[-1] != depot:
            route.append(depot)

        walk_speed = effective_walk_speed()

        # Break + downtime settings
        break_interval = float(params.get("break_interval", 0.0))
        break_duration = float(params.get("break_duration", 0.0))

        for nxt in route[1:]:
            # scheduled break
            if break_interval > 0 and (env.now - last_break) >= break_interval:
                yield env.timeout(break_duration)
                last_break = env.now

            # travel (safe distance lookup)
            d = dist.get(current, {}).get(nxt)
            if d is None:
                # If missing path, skip safely
                current = nxt
                continue

            yield env.timeout(d / walk_speed)
            kpis["total_distance"] += d
            picker_paths.append((current, nxt))
            current = nxt

            # picking time if it's a pick slot
            if nxt in to_visit:
                lines = int((batch_rows["sku_slot"] == str(nxt)).sum())

                if pick_dist == "lognormal":
                    draws = np.random.lognormal(mu, sigma, size=max(1, lines))
                    t_pick = float(draws.sum())
                else:
                    t_pick = pick_time_fixed * max(1, lines)

                yield env.timeout(t_pick)

        completion = env.now
        count_orders = batch_rows["order_id"].nunique()
        kpis["orders_completed"] += count_orders
        kpis["order_cycle_times"].extend([completion - arrival_time] * count_orders)
        kpis["picker_busy_time"] += (completion - start_work)

        tl = kpis["throughput_timeline"]
        if not tl or tl[-1][0] < completion:
            tl.append((completion, kpis["orders_completed"]))
        else:
            tl[-1] = (completion, kpis["orders_completed"])

    # ----------------------------
    # 5) Shift generator (arrivals + batching)
    # ----------------------------
    def shift_gen(env, pool, all_orders):
        uids = all_orders["order_id"].unique().tolist()
        i = 0

        shift_duration = float(params.get("shift_duration") or 0.0)
        batch_size = int(params.get("batch_size") or 1)
        batch_size = max(1, batch_size)

        order_rate = float(params.get("order_rate") or 0.0)  # orders/sec

        while env.now < shift_duration and i < len(uids):
            # Poisson arrivals per batch
            lam = (order_rate / batch_size) if order_rate > 0 else 0.0
            if lam > 0:
                inter = random.expovariate(lam)
                yield env.timeout(inter)
            else:
                # if no arrivals, release immediately (all at time 0)
                if env.now == 0:
                    yield env.timeout(0)
                else:
                    break

            batch_ids = uids[i: i + batch_size]
            batch = all_orders[all_orders["order_id"].isin(batch_ids)]
            arrival = env.now

            with pool.request() as req:
                yield req
                kpis["picker_wait_times"].append(env.now - arrival)
                yield env.process(picker(env, batch, arrival))

            # Optional downtime after a batch
            downtime_chance = float(params.get("downtime_chance", 0.0))
            downtime_duration = float(params.get("downtime_duration", 0.0))
            if downtime_chance > 0 and random.random() < downtime_chance:
                yield env.timeout(downtime_duration)

            i += batch_size

    # ----------------------------
    # 6) Run simulation
    # ----------------------------
    env = simpy.Environment()
    pool = simpy.Resource(env, capacity=int(params.get("num_pickers") or 1))

    t0 = time.time()
    env.process(shift_gen(env, pool, orders_df))
    env.run(until=float(params.get("shift_duration") or 0.0))
    t1 = time.time()

    # ----------------------------
    # 7) Summarize
    # ----------------------------
    num_pickers = int(params.get("num_pickers") or 1)
    sim_time = float(env.now) if env.now else float(params.get("shift_duration") or 0.0)

    avg_cycle = float(np.mean(kpis["order_cycle_times"])) if kpis["order_cycle_times"] else 0.0
    avg_wait = float(np.mean(kpis["picker_wait_times"])) if kpis["picker_wait_times"] else 0.0
    util = (kpis["picker_busy_time"] / (num_pickers * sim_time) * 100.0) if sim_time > 0 else 0.0

    summary = {
        "batch_size": int(params.get("batch_size") or 1),
        "num_pickers": num_pickers,
        "throughput": int(kpis["orders_completed"]),
        "total_distance": float(kpis["total_distance"]),
        "avg_cycle_time": avg_cycle,
        "avg_wait_time": avg_wait,
        "utilization": util,
        "simulation_time_s": float(t1 - t0),
    }

    details = {
        "cycle_times": kpis["order_cycle_times"],
        "throughput_timeline": kpis["throughput_timeline"],
        "picker_paths": picker_paths,
    }

    return summary, details

