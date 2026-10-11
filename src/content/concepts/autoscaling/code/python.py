# A target-tracking autoscaler with warm-up, cooldown and min/max bounds, run over a fixed traffic series.
# One step is one minute. Everything is integers, so the output is identical in every language.
import sys

CAPACITY = 100  # requests per second one warm instance can serve
config = {"target_percent": 60, "warmup": 2, "cooldown": 2, "min": 2, "max": 12}

# Requests per second: quiet, a sharp spike, then a quiet night.
traffic = [150, 160, 150, 170, 400, 800, 1000, 1000, 1000, 900, 700, 500, 300, 200, 150,
           140, 150, 160, 150, 140, 80, 70, 80, 70, 80, 70, 80, 70, 80, 70]


def desired_instances(load, cfg):
    # Enough instances that each one runs at the target utilisation: ceil(load / (capacity * target)).
    per_instance = CAPACITY * cfg["target_percent"]
    return (load * 100 + per_instance - 1) // per_instance


def run(series, cfg):
    ready = cfg["min"]  # warm instances that serve traffic
    warming = []  # minute at which each launched instance becomes ready
    cooldown_left = 0
    instance_minutes = dropped = overloaded = actions = 0
    peak = ready

    for minute, load in enumerate(series):
        ready += len([at for at in warming if at <= minute])
        warming = [at for at in warming if at > minute]
        total = ready + len(warming)

        served = min(load, ready * CAPACITY)
        dropped += (load - served) * 60
        if load > ready * CAPACITY:
            overloaded += 1
        instance_minutes += total  # you pay for instances while they warm up
        peak = max(peak, total)
        ready_now = ready
        util = (load * 100) // (ready * CAPACITY)

        # Decide: clamp to the bounds, and stay quiet during the cooldown.
        desired = max(cfg["min"], min(cfg["max"], desired_instances(load, cfg)))
        action = "hold"
        if cooldown_left > 0:
            cooldown_left -= 1
        elif desired > total:
            warming.extend([minute + 1 + cfg["warmup"]] * (desired - total))
            action = f"out +{desired - total}"
            cooldown_left = cfg["cooldown"]
        elif desired < total:
            remove = total - desired
            while remove > 0 and warming:  # drop the newest first
                warming.pop()
                remove -= 1
            ready -= remove
            action = f"in -{total - desired}"
            cooldown_left = cfg["cooldown"]
        if action != "hold":
            actions += 1
        print(f"min {minute:>2} load {load:>4} ready {ready_now:>2} total {total:>2} util {util:>3}% {action}")
    return instance_minutes, dropped, overloaded, actions, peak


instance_minutes, dropped, overloaded, actions, peak = run(traffic, config)
print(f"instance-minutes {instance_minutes}, dropped or slow requests {dropped}")
print(f"overloaded minutes {overloaded}, scaling actions {actions}, peak instances {peak}")

# Invariants: bounds respected, and the spike really did cause some overload while instances warmed up.
if peak > config["max"] or peak < config["min"]:
    sys.exit(1)
if overloaded == 0 or instance_minutes < len(traffic) * config["min"]:
    sys.exit(1)
