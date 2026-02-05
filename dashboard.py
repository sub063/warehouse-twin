# dashboard.py
import os
import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import altair as alt

from sim_step2 import run_warehouse_sim
from sim_mc import monte_carlo


# -----------------------------
# Page setup + styling
# -----------------------------
st.set_page_config(page_title="Warehouse Simulator Control Center", layout="wide")

st.markdown(
    """
    <style>
      /* Modern bin map */
.bin-map {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 10px 30px rgba(0,0,0,0.25);
  overflow: auto;
}
.bin {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(120,170,255,0.35), rgba(120,170,255,0.10));
  border: 1px solid rgba(180,210,255,0.18);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.10);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  cursor: default;              /* not clickable */
}
.bin:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.12);
}
.bin--hot {
  background: linear-gradient(180deg, rgba(255,90,90,0.45), rgba(255,90,90,0.12));
  border: 1px solid rgba(255,130,130,0.22);
}
.bin-legend {
  display:flex; gap:14px; align-items:center; margin-top:10px; color:#A8DADC;
  font-size: 0.95rem;
}
.bin-dot {
  width: 12px; height: 12px; border-radius: 4px; display:inline-block;
  border: 1px solid rgba(255,255,255,0.18);
}
    </style>
    """,
    unsafe_allow_html=True,
)

st.title("Warehouse Simulator Control Center")


# -----------------------------
# Data loading
# -----------------------------
@st.cache_data
def load_orders_csv(path="orders.csv"):
    if not os.path.exists(path):
        return pd.DataFrame(columns=["order_id", "current_slot", "sku_slot"])
    return pd.read_csv(path, dtype={"sku_slot": str})


orders_df = load_orders_csv("orders.csv")


# -----------------------------
# Presets
# -----------------------------
presets = {
    "Default": {
        "n_aisles": 5, "bays": 20, "cross_freq": 1,
        "batch": 4, "pickers": 3,
        "pick_dist": "Fixed", "pick_mean": 30.0, "pick_cv": 50,
        "shift_hrs": 8, "walk_speed": 1.5,
        "arrival_rate": 60.0,
        "congestion": 50,
        "order_size": 50,
        "mc_draws": 200,
    },
    "High-throughput": {
        "n_aisles": 10, "bays": 40, "cross_freq": 2,
        "batch": 10, "pickers": 8,
        "pick_dist": "Fixed", "pick_mean": 25.0, "pick_cv": 20,
        "shift_hrs": 10, "walk_speed": 1.8,
        "arrival_rate": 300.0,
        "congestion": 20,
        "order_size": 200,
        "mc_draws": 200,
    },
    "Slow-moving SKUs": {
        "n_aisles": 5, "bays": 20, "cross_freq": 1,
        "batch": 2, "pickers": 2,
        "pick_dist": "Log-normal", "pick_mean": 40.0, "pick_cv": 80,
        "shift_hrs": 8, "walk_speed": 1.2,
        "arrival_rate": 20.0,
        "congestion": 80,
        "order_size": 100,
        "mc_draws": 200,
    },
}


# -----------------------------
# Sidebar controls
# -----------------------------
st.sidebar.title("⚙️ Settings & Presets")
sel = st.sidebar.selectbox("Choose a preset", list(presets.keys()))
sp = presets[sel]

st.sidebar.title("🔧 Layout & Simulation Settings")

with st.sidebar.expander("Layout Dimensions", expanded=True):
    n_aisles = st.slider("Number of aisles", 1, 20, sp["n_aisles"])
    bays_per_aisle = st.slider("Bays per aisle", 1, 100, sp["bays"])
    cross_freq = st.slider("Cross-aisle frequency", 0, 10, sp["cross_freq"])

with st.sidebar.expander("Order & Picker Settings", expanded=True):
    batch_size = st.slider("Batch size", 1, 20, sp["batch"])
    picker_count = st.slider("Picker count", 1, 10, sp["pickers"])
    single_pick = st.checkbox("Single-pick mode: each pick = one order", value=False)

    if orders_df.empty:
        st.sidebar.warning("orders.csv not found or empty. Add orders.csv or generate one.")
        order_size = 0
        subset = orders_df
    else:
        order_size = (
            st.slider("Number of picks", 1, min(1000, len(orders_df)), sp["order_size"])
            if single_pick else
            st.slider("Number of orders", 1, len(orders_df["order_id"].unique()), sp["order_size"])
        )
        subset = (
            orders_df.head(order_size)
            if single_pick else
            orders_df[orders_df["order_id"].isin(orders_df["order_id"].unique()[:order_size])]
        )
        st.markdown(f"**Unique bins:** {subset['sku_slot'].nunique()}")

with st.sidebar.expander("Pick Time Distribution", expanded=False):
    pick_dist = st.selectbox(
        "Pick-time dist",
        ["Fixed", "Log-normal"],
        index=["Fixed", "Log-normal"].index(sp["pick_dist"]),
    )
    pick_mean = st.number_input("Avg pick time (s)", 0.1, 300.0, float(sp["pick_mean"]))

    if pick_dist == "Log-normal":
        cv = st.slider("Variability (%)", 0, 200, sp["pick_cv"])
        pick_std = pick_mean * cv / 100.0

        mu = np.log((pick_mean**2) / np.sqrt(pick_std**2 + pick_mean**2))
        sigma = np.sqrt(np.log(1 + (pick_std**2) / (pick_mean**2)))
        dfp = pd.DataFrame({"t": np.random.lognormal(mu, sigma, 500)})

        st.sidebar.altair_chart(
            alt.Chart(dfp).mark_bar(opacity=0.7).encode(
                alt.X("t:Q", bin=alt.Bin(maxbins=30), title="Pick time (s)"),
                alt.Y("count()", title="Count"),
            ).properties(width=300, height=150, title="Pick-time preview")
        )
    else:
        pick_std = 0.0

with st.sidebar.expander("Shift & Travel", expanded=False):
    shift_hours = st.slider("Shift length (hrs)", 1, 24, sp["shift_hrs"])
    walking_speed = st.number_input("Walking speed (m/s)", 0.5, 3.0, float(sp["walk_speed"]))

with st.sidebar.expander("Arrivals & Congestion", expanded=False):
    arrival_rate_hr = st.number_input("Orders/hr", 0.0, 10000.0, float(sp["arrival_rate"]))
    congestion_pct = st.slider("Slowdown (% per extra picker)", 0, 200, sp["congestion"])
    congestion_slowdown = congestion_pct / 100.0

with st.sidebar.expander("Breaks & Downtime", expanded=False):
    break_interval_min = st.number_input("Break interval (min)", 0.0, 180.0, 60.0)
    break_duration_min = st.number_input("Break duration (min)", 0.0, 60.0, 10.0)
    downtime_chance_pct = st.slider("Equipment downtime chance (%)", 0, 100, 10)
    downtime_chance = downtime_chance_pct / 100.0
    downtime_duration_min = st.number_input("Downtime duration (min)", 0.0, 60.0, 5.0)

with st.sidebar.expander("Monte Carlo", expanded=False):
    mc_draws = st.slider("Monte Carlo draws", 0, 1000, sp["mc_draws"], step=50)
    mc_enabled = st.checkbox("Run Monte Carlo on scenario", value=True)

run_btn = st.sidebar.button("🚀 Run scenario")
clear_btn = st.sidebar.button("🧹 Clear all runs")


# -----------------------------
# Session state
# -----------------------------
if "scenarios" not in st.session_state:
    st.session_state.scenarios = []
if "selected_bins" not in st.session_state:
    st.session_state.selected_bins = set()

if clear_btn:
    st.session_state.scenarios = []
    st.success("Cleared all runs.")


# -----------------------------
# Helpers
# -----------------------------
def build_params():
    return {
        "batch_size": batch_size,
        "num_pickers": picker_count,
        "shift_duration": shift_hours * 3600,
        "num_aisles": n_aisles,
        "bays_per_aisle": bays_per_aisle,
        "cross_aisle_frequency": cross_freq,
        "depot_location": (0, 0),
        "pick_time_dist": pick_dist.lower(),
        "pick_time": pick_mean if pick_dist == "Fixed" else None,
        "pick_time_mean": pick_mean,
        "pick_time_std": pick_std,
        "walking_speed": walking_speed,
        "order_rate": arrival_rate_hr / 3600.0,
        "congestion_slowdown": congestion_slowdown,
        "break_interval": break_interval_min * 60,
        "break_duration": break_duration_min * 60,
        "downtime_chance": downtime_chance,
        "downtime_duration": downtime_duration_min * 60,
    }


def get_sim_orders():
    if orders_df.empty:
        return orders_df
    sim_orders = subset.copy()
    if single_pick:
        sim_orders = sim_orders.head(order_size).copy()
        sim_orders["order_id"] = sim_orders.index.astype(str)
    return sim_orders


def safe_pct_delta(new, old):
    if old == 0:
        return None
    return (new - old) / old * 100.0


def centered_plotly(fig, height=520):
    """
    Center a plotly chart and cap width for readability.
    """
    fig.update_layout(
        height=height,
        margin=dict(l=30, r=30, t=60, b=40),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="center", x=0.5),
        title_x=0.5,  # center title
    )
    st.markdown('<div class="center-wrap"><div class="plot-wrap">', unsafe_allow_html=True)
    st.plotly_chart(fig, use_container_width=True)
    st.markdown("</div></div>", unsafe_allow_html=True)


# -----------------------------
# Run scenario
# -----------------------------
if run_btn:
    if orders_df.empty:
        st.error("orders.csv is missing/empty. Add orders.csv or generate one, then rerun.")
    else:
        params = build_params()
        sim_orders = get_sim_orders()

        with st.spinner("Running simulation..."):
            summary, details = run_warehouse_sim(params, orders_df=sim_orders)

        distances = []
        if mc_enabled and mc_draws > 0:
            with st.spinner(f"Running Monte Carlo ({mc_draws} draws)..."):
                distances = monte_carlo(mc_draws, params=params)

        name = f"Run {len(st.session_state.scenarios) + 1}"
        st.session_state.scenarios.append(
            {"name": name, "params": params, "summary": summary, "details": details, "distances": distances}
        )


# -----------------------------
# KPIs
# -----------------------------
st.markdown("## 📊 Key Performance Metrics & Changes")

if st.session_state.scenarios:
    base = st.session_state.scenarios[0]
    last = st.session_state.scenarios[-1]
    bS, lS = base["summary"], last["summary"]

    base_cycle = float(bS.get("avg_cycle_time", 0.0) or 0.0)
    last_cycle = float(lS.get("avg_cycle_time", 0.0) or 0.0)

    base_thr = int(bS.get("throughput", 0) or 0)
    last_thr = int(lS.get("throughput", 0) or 0)

    base_dist = float(np.mean(base["distances"])) if base["distances"] else 0.0
    last_dist = float(np.mean(last["distances"])) if last["distances"] else 0.0

    c1, c2, c3 = st.columns(3)
    c1.metric(
        "Avg cycle time (s)",
        f"{last_cycle:.1f}",
        delta=(f"{safe_pct_delta(last_cycle, base_cycle):+.1f}%" if safe_pct_delta(last_cycle, base_cycle) is not None else "—"),
    )
    c2.metric(
        "Throughput (orders)",
        f"{last_thr}",
        delta=(f"{safe_pct_delta(last_thr, base_thr):+.1f}%" if safe_pct_delta(last_thr, base_thr) is not None else "—"),
    )
    c3.metric(
        "Mean travel dist (m)",
        f"{last_dist:.1f}",
        delta=(f"{safe_pct_delta(last_dist, base_dist):+.1f}%" if safe_pct_delta(last_dist, base_dist) is not None else "—"),
    )
else:
    st.info("No scenarios yet. Click 🚀 Run scenario to begin.")


# -----------------------------
# Tabs
# -----------------------------
tabs = st.tabs(["🗺️ Layout", "📋 Scenarios", "🔄 Cycle-Time", "⏱️ Throughput", "🎲 Monte Carlo", "ℹ️ Info"])


# Layout tab
# Layout tab (modern, non-clickable)
with tabs[0]:
    st.markdown("## Layout & Storage Placement")
    st.caption("Modern layout preview (not interactive). Hover bins for coordinates.")

    # Cap render for performance
    max_aisles_ui = min(n_aisles, 20)
    max_bays_ui = min(bays_per_aisle, 60)

    # Optional: highlight bins that appear in the selected subset of orders
    hot_bins = set()
    if not orders_df.empty and "sku_slot" in subset.columns:
        # subset sku_slot is stored like "(a, b)" as a string
        hot_bins = set(subset["sku_slot"].astype(str).tolist())

    # Build HTML grid
    cols_css = f"grid-template-columns: repeat({max_bays_ui}, 28px);"
    html = [f'<div class="bin-map" style="{cols_css}">']

    for a in range(max_aisles_ui):
        for b in range(max_bays_ui):
            key = f"({a}, {b})"
            cls = "bin bin--hot" if key in hot_bins else "bin"
            html.append(f'<div class="{cls}" title="Bin {key}"></div>')

    html.append("</div>")
    st.markdown("".join(html), unsafe_allow_html=True)

    st.markdown(
        """
        <div class="bin-legend">
          <span><span class="bin-dot" style="background:rgba(120,170,255,0.35)"></span> Normal bin</span>
          <span><span class="bin-dot" style="background:rgba(255,90,90,0.45)"></span> Used in current orders</span>
        </div>
        """,
        unsafe_allow_html=True
    )

    st.caption(f"Showing {max_aisles_ui} aisles × {max_bays_ui} bays (UI preview cap).")


# Scenarios tab
with tabs[1]:
    st.markdown("## Scenario List & Metrics")
    if not st.session_state.scenarios:
        st.info("No scenarios to display.")
    else:
        df = pd.DataFrame(
            [
                {
                    "Name": s["name"],
                    "Batch": s["params"]["batch_size"],
                    "Pickers": s["params"]["num_pickers"],
                    "Aisles": s["params"]["num_aisles"],
                    "Bays": s["params"]["bays_per_aisle"],
                    "ShiftHrs": s["params"]["shift_duration"] / 3600.0,
                    "Orders/hr": s["params"]["order_rate"] * 3600.0,
                    "AvgCycle(s)": s["summary"].get("avg_cycle_time", 0.0),
                    "Throughput": s["summary"].get("throughput", 0),
                    "Util(%)": s["summary"].get("utilization", 0.0),
                    "MeanDist(m)": float(np.mean(s["distances"])) if s["distances"] else 0.0,
                }
                for s in st.session_state.scenarios
            ]
        ).set_index("Name")
        st.dataframe(df, use_container_width=True)


# Cycle-Time tab (STRICT: one full-width centered chart per run, stacked vertically)
with tabs[2]:
    st.markdown("## Cycle-Time Distribution")
    st.markdown('<div class="caption">Each run is shown as its own chart, stacked vertically for easy comparison.</div>', unsafe_allow_html=True)

    if not st.session_state.scenarios:
        st.info("Run a scenario to view cycle-time distribution.")
    else:
        # global axis for fair comparison
        all_ct = []
        for s in st.session_state.scenarios:
            all_ct.extend(s["details"].get("cycle_times", []))
        y_max = max(all_ct) if all_ct else None

        for s in st.session_state.scenarios:
            name = s["name"]
            cts = s["details"].get("cycle_times", [])

            st.markdown(f"### {name}")
            if not cts:
                st.warning("No cycle time data in this run.")
                st.divider()
                continue

            df_ct = pd.DataFrame({"CycleTime": cts})

            # One clean chart per run: histogram (most readable)
            fig = px.histogram(
                df_ct,
                x="CycleTime",
                nbins=45,
                title=f"{name} — Cycle Time Histogram",
            )
            if y_max is not None:
                fig.update_xaxes(range=[0, y_max])

            centered_plotly(fig, height=520)

            # Small stats row under chart
            p50 = float(np.percentile(cts, 50))
            p90 = float(np.percentile(cts, 90))
            p95 = float(np.percentile(cts, 95))
            cA, cB, cC, cD = st.columns(4)
            cA.metric("n", f"{len(cts)}")
            cB.metric("Median (p50)", f"{p50:.1f}s")
            cC.metric("p90", f"{p90:.1f}s")
            cD.metric("p95", f"{p95:.1f}s")

            st.divider()


# Throughput tab (stacked per run)
with tabs[3]:
    st.markdown("## Throughput Timeline")
    st.markdown('<div class="caption">Each run is shown as its own chart, stacked vertically.</div>', unsafe_allow_html=True)

    if not st.session_state.scenarios:
        st.info("Run a scenario to view throughput timeline.")
    else:
        for s in st.session_state.scenarios:
            name = s["name"]
            tl = s["details"].get("throughput_timeline", [])

            st.markdown(f"### {name}")
            if not tl:
                st.warning("No throughput timeline data in this run.")
                st.divider()
                continue

            df_tl = pd.DataFrame(tl, columns=["Time", "Orders"])
            fig = px.line(
                df_tl,
                x="Time",
                y="Orders",
                markers=True,
                title=f"{name} — Cumulative Orders Completed",
            )
            centered_plotly(fig, height=520)
            st.divider()


# Monte Carlo tab (stacked per run)
with tabs[4]:
    st.markdown("## Monte Carlo Distance Distribution")
    st.markdown('<div class="caption">Each run is shown as its own chart, stacked vertically.</div>', unsafe_allow_html=True)

    if not st.session_state.scenarios:
        st.info("Run a scenario to view Monte Carlo results.")
    else:
        for s in st.session_state.scenarios:
            name = s["name"]
            dists = s.get("distances", [])

            st.markdown(f"### {name}")
            if not dists:
                st.warning("No Monte Carlo results for this run (disable MC or draws=0).")
                st.divider()
                continue

            df_mc = pd.DataFrame({"Distance": dists})
            fig = px.histogram(
                df_mc,
                x="Distance",
                nbins=45,
                title=f"{name} — Monte Carlo Distance Histogram",
            )
            centered_plotly(fig, height=520)

            p50 = float(np.percentile(dists, 50))
            p90 = float(np.percentile(dists, 90))
            p95 = float(np.percentile(dists, 95))
            cA, cB, cC, cD = st.columns(4)
            cA.metric("n", f"{len(dists)}")
            cB.metric("Median (p50)", f"{p50:.1f}m")
            cC.metric("p90", f"{p90:.1f}m")
            cD.metric("p95", f"{p95:.1f}m")

            st.divider()


# Info / Glossary tab (refined)
with tabs[5]:
    st.markdown("## ℹ️ Dashboard Guide & Glossary")
    st.caption("Plain-English definitions for every setting, metric, and chart label used in this dashboard.")

    # --- Quick search ---
    q = st.text_input("Search terms (example: bins, throughput, Monte Carlo, congestion)", value="").strip().lower()

    def show(section_text: str) -> bool:
        """Simple filter: show section if query is empty or query appears in section."""
        if not q:
            return True
        return q in section_text.lower()

    # --- Quick orientation ---
    intro = """
    This dashboard simulates warehouse order picking. You change the layout and operating rules (pickers, batching, pick time, breaks, arrivals),
    then compare results across multiple runs. Each run is saved as **Run 1, Run 2, ...** and shown as separate charts for readability.
    """
    if show(intro):
        st.info(intro)

    # --- KPI definitions ---
    kpi_text = """
    **Avg cycle time (s)** = average time (seconds) from an order/batch entering the system to completion.
    **Throughput (orders)** = total number of orders completed within the simulated shift.
    **Mean travel dist (m)** = average distance (meters) walked, computed from shortest paths in the layout.
    """
    with st.expander("📊 Key Metrics (Top KPIs)", expanded=True):
        if show(kpi_text):
            st.markdown(
                """
**Avg cycle time (s)**  
- What it means: The average time to finish work from start → done (in seconds).  
- How to read it: Lower is faster. If it rises when you increase batch size, that can be normal (orders wait inside a bigger batch).

**Throughput (orders)**  
- What it means: How many orders were completed before the shift ended.  
- How to read it: Higher is better. If arrivals are low, throughput may cap even with many pickers.

**Mean travel dist (m)**  
- What it means: Average walking distance the picker traveled, estimated from the warehouse graph shortest paths.  
- How to read it: Lower usually means better layout, more cross-aisle shortcuts, or smarter batching.
"""
            )
        else:
            st.caption("No match for your search in this section.")

    # --- Layout definitions ---
    layout_text = """
    number of aisles bays per aisle cross-aisle frequency bins aisle bay coordinates
    """
    with st.expander("🧱 Layout Dimensions (Warehouse Shape)", expanded=False):
        if show(layout_text):
            st.markdown(
                """
**Bins**  
- A **bin** is one storage location. In this model a bin is written like `(aisle, bay)`.

**Number of aisles**  
- How many aisle rows exist. More aisles usually means a larger building footprint.

**Bays per aisle**  
- How many bin locations exist along an aisle. More bays means longer aisles / more slots.

**Cross-aisle frequency**  
- How often cross-aisles exist that allow side-to-side movement between aisles.  
- Higher frequency usually reduces walking distance because it creates more shortcuts.
"""
            )
            st.caption("Tip: If you shrink the layout, some bins in orders may not exist anymore; the simulator filters invalid bins automatically.")
        else:
            st.caption("No match for your search in this section.")

    # --- Order & picker settings ---
    ops_text = """
    batch size picker count number of orders unique bins single-pick mode
    """
    with st.expander("👷 Order & Picker Settings (How Work Is Grouped)", expanded=False):
        if show(ops_text):
            st.markdown(
                """
**Batch size**  
- How many orders are grouped together into one pick tour.  
- Tradeoff: Larger batches can reduce travel per order, but can increase cycle time for individual orders.

**Picker count**  
- How many pickers work in parallel.  
- More pickers usually increases throughput until congestion starts to dominate.

**Number of orders**  
- How many orders from the dataset are included in this run.

**Unique bins**  
- The number of distinct bin locations touched by those orders.  
- More unique bins usually means more walking and longer tours.

**Single-pick mode**  
- Each pick line acts like its own “order.” Useful for quick stress tests.
"""
            )
        else:
            st.caption("No match for your search in this section.")

    # --- Pick time distribution ---
    pick_text = """
    pick time distribution fixed log-normal variability mean std
    """
    with st.expander("⏱️ Pick Time Distribution (How Long Each Pick Takes)", expanded=False):
        if show(pick_text):
            st.markdown(
                """
**Pick-time dist**  
- **Fixed**: every pick takes the same amount of time.  
- **Log-normal**: pick times vary (many normal picks + a few very slow picks). This matches real operations better.

**Avg pick time (s)**  
- The average time to pick one line/item.

**Variability (%)** *(log-normal only)*  
- Controls how spread out pick times are.  
- Higher variability = more unpredictability = higher cycle time tails (p90/p95 rise).
"""
            )
        else:
            st.caption("No match for your search in this section.")

    # --- Shift & travel ---
    shift_text = """
    shift length walking speed travel time meters per second
    """
    with st.expander("🚶 Shift & Travel (Time + Walking)", expanded=False):
        if show(shift_text):
            st.markdown(
                """
**Shift length (hrs)**  
- Total time the simulation is allowed to run.

**Walking speed (m/s)**  
- How fast a picker moves.  
- Higher speed reduces travel time and cycle time.
"""
            )
        else:
            st.caption("No match for your search in this section.")

    # --- Arrivals & congestion ---
    arr_text = """
    arrivals orders per hour order rate congestion slowdown
    """
    with st.expander("📥 Arrivals & Congestion (Demand + Crowding)", expanded=False):
        if show(arr_text):
            st.markdown(
                """
**Orders/hr**  
- How many new orders arrive per hour (demand rate).  
- If orders/hr is low, throughput might not increase even if you add pickers.

**Slowdown (% per extra picker)**  
- A simple congestion model: adding pickers reduces walking speed because aisles get crowded.  
- If set to 0%, pickers never slow each other down.
"""
            )
        else:
            st.caption("No match for your search in this section.")

    # --- Breaks & downtime ---
    bd_text = """
    breaks downtime equipment chance duration
    """
    with st.expander("🛑 Breaks & Downtime (Interruptions)", expanded=False):
        if show(bd_text):
            st.markdown(
                """
**Break interval (min)**  
- How often scheduled breaks occur.

**Break duration (min)**  
- How long breaks last.

**Equipment downtime chance (%)**  
- Probability a downtime event happens after a batch is processed.

**Downtime duration (min)**  
- How long the downtime lasts when it occurs.
"""
            )
        else:
            st.caption("No match for your search in this section.")

    # --- Monte Carlo ---
    mc_text = """
    monte carlo draws randomness uncertainty distribution distance
    """
    with st.expander("🎲 Monte Carlo (Uncertainty / Variability)", expanded=False):
        if show(mc_text):
            st.markdown(
                """
**Monte Carlo draws**  
- Number of randomized samples used to estimate variability in travel distance (and related outcomes).  
- More draws = smoother distribution, but slower computation.
"""
            )
        else:
            st.caption("No match for your search in this section.")

    # --- Presets ---
    preset_text = """
    presets default high-throughput slow-moving skus
    """
    with st.expander("⚙️ Presets (Quick Starting Points)", expanded=False):
        if show(preset_text):
            st.markdown(
                """
**Default**  
- Balanced baseline values. Good starting point.

**High-throughput**  
- More aisles/bays, more pickers, bigger batches, higher arrivals.  
- Used to stress capacity and throughput.

**Slow-moving SKUs**  
- Slower and more variable pick times.  
- Used to stress cycle-time tail behavior (p90/p95).
"""
            )
        else:
            st.caption("No match for your search in this section.")

    # --- Tabs & axis labels ---
    axis_text = """
    axis labels cycle time histogram throughput timeline monte carlo distance time orders count
    """
    with st.expander("📈 Tabs + Chart Axis Labels (How to Read the Graphs)", expanded=True):
        if show(axis_text):
            st.markdown(
                """
### Tabs (what each one shows)
- **🗺️ Layout**: A visual grid of bins (selection UI / layout preview).
- **📋 Scenarios**: A table comparing each run.
- **🔄 Cycle-Time**: One chart per run showing the **distribution** of cycle times.
- **⏱️ Throughput**: One chart per run showing **orders completed over time**.
- **🎲 Monte Carlo**: One chart per run showing **distribution of travel distances** across draws.

### Axis Labels (by chart)
**Cycle-Time Histogram (per run)**  
- **X: CycleTime** = cycle time values (seconds)  
- **Y: Count** = how many completed items fell in that range

**Throughput Timeline (per run)**  
- **X: Time** = simulated time (seconds)  
- **Y: Orders** = cumulative completed orders up to that time

**Monte Carlo Distance Histogram (per run)**  
- **X: Distance** = simulated travel distance (meters)  
- **Y: Count** = how often that distance occurred across draws
"""
            )
        else:
            st.caption("No match for your search in this section.")

    st.divider()
    st.caption("If you want, I can add a small “?” icon next to each KPI and sidebar control that shows these definitions as tooltips.")
