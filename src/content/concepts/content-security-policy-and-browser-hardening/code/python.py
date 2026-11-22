# A toy Content Security Policy evaluator. A page requests 11 resources it needs, and an XSS flaw has let an attacker inject 4 more.
# For each policy we decide, resource by resource, what the browser would load or run. A model of the rules, not a browser:
# real CSP has more directives and edge cases. Integers and strings only, so every language prints the same lines.
SELF = "self"


def res(id, kind, frm, nonce=None, hash=None, injected=False, trusted=False):
    # kind: script | style | img | frame | connect | handler (an inline event handler such as onclick). frm: origin or 'inline'.
    # nonce: the nonce attribute the element carries. hash: the hash of its inline text. trusted: loaded at runtime by an already trusted script.
    return {"id": id, "kind": kind, "from": frm, "nonce": nonce, "hash": hash, "injected": injected, "trusted": trusted}


RESOURCES = [
    res("app.js", "script", SELF, nonce="good"),
    res("lib.js (cdn.example)", "script", "cdn.example", nonce="good"),
    res("track.js (analytics.vendor)", "script", "analytics.vendor", nonce="good"),
    res("inline bootstrap script", "script", "inline", nonce="good", hash="h1"),
    res("inline onclick handler", "handler", "inline"),
    res("site.css", "style", SELF),
    res("inline style block", "style", "inline", nonce="good", hash="h2"),
    res("hero.png (img.cdn)", "img", "img.cdn"),
    res("payment iframe (pay.example)", "frame", "pay.example"),
    res("fetch to api.shop.example", "connect", "api.shop.example"),
    res("chart.js loaded by app.js", "script", "unpkg.example", trusted=True),
    # Injected through an XSS flaw. The nonce is only used when the attacker has learned the page's nonce.
    res("injected inline script", "script", "inline", injected=True),
    res("injected img onerror handler", "handler", "inline", injected=True),
    res("injected script from evil.example", "script", "evil.example", injected=True),
    res("injected script via cdn.example", "script", "cdn.example", injected=True),  # an allow-listed host that serves attacker-chosen code
]
MAIN, FALLBACK = "script-src", "default-src"
BASE = {"img-src": ["self", "img.cdn"], "frame-src": ["pay.example"], "connect-src": ["self", "api.shop.example"]}
POLICIES = {
    "none": None,
    "allow-list + unsafe-inline": {**BASE, "script-src": ["self", "cdn.example", "analytics.vendor", "unsafe-inline"], "style-src": ["self", "unsafe-inline"]},
    "allow-list only": {**BASE, "script-src": ["self", "cdn.example", "analytics.vendor"], "style-src": ["self"]},
    "hashes + allow-list": {**BASE, "script-src": ["self", "cdn.example", "analytics.vendor", "hash:h1"], "style-src": ["self", "hash:h2"]},
    "nonce + strict-dynamic": {**BASE, "script-src": ["nonce:good", "strict-dynamic"], "style-src": ["self", "nonce:good"]},
    "default-src 'none'": {"default-src": []},
}
DIRECTIVE = {"script": MAIN, "handler": MAIN, "style": "style-src", "img": "img-src", "frame": "frame-src", "connect": "connect-src"}


def allows(policy, r, nonce_leaked):
    if policy is None:
        return True
    src = policy.get(DIRECTIVE[r["kind"]])
    if src is None:
        src = policy.get(FALLBACK)
    if src is None:
        return True
    nonce = ("good" if nonce_leaked else None) if r["injected"] else r["nonce"]
    has_nonce_or_hash = any(s.startswith("nonce:") or s.startswith("hash:") for s in src)
    if r["from"] == "inline":
        if r["kind"] == "handler":
            return "unsafe-inline" in src and not has_nonce_or_hash  # nonces and hashes do not cover handler attributes
        if nonce and "nonce:" + nonce in src:
            return True
        if r["hash"] and not r["injected"] and "hash:" + r["hash"] in src:
            return True
        return "unsafe-inline" in src and not has_nonce_or_hash  # unsafe-inline is ignored once a nonce or hash is present
    if "strict-dynamic" in src and r["kind"] == "script":
        return bool(r["trusted"] or (nonce and "nonce:" + nonce in src))  # host lists are ignored
    if nonce and "nonce:" + nonce in src:
        return True
    return (SELF if r["from"] == SELF else r["from"]) in src


def evaluate(policy, report_only, nonce_leaked):
    out = {"legit": 0, "ran": 0, "violations": 0, "broken": [], "ran_injected": []}
    for r in RESOURCES:
        ok = allows(policy, r, nonce_leaked)
        if not ok:
            out["violations"] += 1
        loads = ok or report_only  # report-only logs the violation but changes nothing
        if r["injected"]:
            if loads and r["kind"] != "img":
                out["ran"] += 1
                out["ran_injected"].append(r["id"])
        elif loads:
            out["legit"] += 1
        else:
            out["broken"].append(r["id"])
    return out


def line(name, o):
    return f"{name}: legit resources loaded {o['legit']} of 11; injected scripts that run {o['ran']} of 4; violations reported {o['violations']}"


print("-- enforcing, nonce not leaked")
for name, p in POLICIES.items():
    print("  " + line(name, evaluate(p, False, False)))
print("-- what an injected script still runs under each policy")
for name, p in POLICIES.items():
    o = evaluate(p, False, False)
    print(f"  {name}: {', '.join(o['ran_injected']) or 'none'}")
print("-- what breaks for legitimate resources")
for name in ["allow-list only", "hashes + allow-list", "nonce + strict-dynamic"]:
    print(f"  {name}: {', '.join(evaluate(POLICIES[name], False, False)['broken']) or 'nothing'}")
print("-- break it: the same nonce on every response, so the attacker copies it")
print("  " + line("nonce + strict-dynamic, static nonce", evaluate(POLICIES["nonce + strict-dynamic"], False, True)))
print("-- report-only rollout: nothing blocked, violations collected first")
print("  " + line("allow-list only, report-only", evaluate(POLICIES["allow-list only"], True, False)))
print("  " + line("default-src 'none', report-only", evaluate(POLICIES["default-src 'none'"], True, False)))

# Other headers: each one stops one kind of attack, none replaces a CSP.
ATTACKS = [
    ("a return visit typed as http, attacker strips the redirect to https", "hsts", "HSTS (after a first visit)"),
    ("evil.example frames the page to trick clicks", "frame-ancestors", "frame-ancestors"),
    ("an uploaded .txt is sniffed and run as script", "nosniff", "X-Content-Type-Options: nosniff"),
    ("evil.example posts a form to the shop with the session cookie", "samesite", "SameSite=Lax cookie"),
]


def headers(hs):
    stopped = [a for a in ATTACKS if a[1] in hs]
    return f"headers [{', '.join(hs) or 'none'}]: stops {len(stopped)} of 4 attacks"


print("-- other headers")
print("  " + headers([]))
print("  " + headers(["frame-ancestors"]))
print("  " + headers(["hsts", "frame-ancestors", "nosniff", "samesite"]))
for what, key, name in ATTACKS:
    print(f"  with only frame-ancestors and SameSite: {what}: {'stopped by ' + name if key in ['frame-ancestors', 'samesite'] else 'still works'}")
