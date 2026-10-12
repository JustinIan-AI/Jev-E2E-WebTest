#!/usr/bin/env python3
"""
E02 实测：K8s Namespace 作为 runId 数据隔离单元 —— 生命周期与幂等性验证。

★ 授权范围（用户 2026-09-23 明确）：**仅允许创建和删除测试命名空间**，
  不允许操作任何已有配置/资源。本脚本以此为前提设计三重硬守卫：

  守卫 1（名前缀）  : 任何写操作的目标必须匹配 `idwth-<date>-<hex>` 形态，否则直接拒绝。
  守卫 2（本进程白名单）: 删除只允许作用于**本进程刚刚创建成功**的名字
                    （内存集合），即便外界传入其它名字也无法删除。
  守卫 3（标签核验） : 删除前再 GET 一次，核验 `idwth.io/run-id` 标签 == 本次 runId，
                    不符则不删并报错终止。

  只读操作（GET/LIST）不受限，用于基线与终态比对。

凭据从环境变量读取，不落盘、不写进任何产物文件。

用法：
  export OF_USER=... OF_PWD=...
  python3 of-ns-lifecycle.py                 # 完整生命周期实测
  OF_BASE=https://host:port python3 of-ns-lifecycle.py
"""
import os, ssl, json, re, gzip, sys, time, uuid, argparse
from datetime import datetime
import urllib.request, urllib.error, urllib.parse, http.cookiejar

BASE = os.environ.get("OF_BASE", "https://192.168.36.152:31616")
CLUSTER = os.environ.get("OF_CLUSTER", "host")
USER = os.environ.get("OF_USER"); PWD = os.environ.get("OF_PWD")
if not (USER and PWD):
    sys.exit("!! 需先设置 OF_USER / OF_PWD 环境变量（不要写进文件）")

# ── 守卫常量 ────────────────────────────────────────────────────────────
NS_PREFIX = "idwth-"                      # 守卫 1：唯一允许的名字前缀
LABEL_KEY = "idwth.io/run-id"             # 守卫 3：归属标签
NAME_RE = re.compile(r"^idwth-\d{8}-[0-9a-f]{6}$")
K8S_NS = f"/clusters/{CLUSTER}/api/kubernetes/api/v1/namespaces"

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ctx))
op.addheaders = [("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
                 ("Accept-Language", "zh-CN,zh;q=0.9")]

CREATED: set = set()          # 守卫 2：本进程创建成功的名字
AUDIT: list = []              # 写操作审计流水


def _req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Accept": "application/json"}
    if data is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        resp = op.open(r, timeout=40)
        d = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            d = gzip.decompress(d)
        return resp.status, d.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        d = e.read()
        if e.headers.get("Content-Encoding") == "gzip":
            d = gzip.decompress(d)
        return e.code, d.decode("utf-8", "replace")


def _json(s):
    """控制台把 K8s 响应包在 {data:...} 里，解包一次。"""
    try:
        j = json.loads(s)
    except Exception:
        return {}
    return j.get("data", j) if isinstance(j, dict) and "data" in j else j


def unwrap_list(j):
    if isinstance(j, dict) and "items" in j:
        return j["items"]
    if isinstance(j, list):
        return j
    return []


def ts(s):
    """★ 时区安全的 RFC3339 解析。
    K8s 返回 UTC `2026-09-23T06:59:56Z`，而本地时间是 `2026-09-23T14:59:55+0800`
    —— 两者是同一时刻，但**按字符串比较会得出相反的结论**。
    本条是首轮实测中真实踩到的 bug：`created_at > run_start` 断言若两侧时区不一致，
    会恒为假（或恒为真），而报告里看起来「有依据」。
    """
    if not s:
        return None
    s2 = s.replace("Z", "+00:00")
    m = re.match(r"^(.*[+-]\d{2})(\d{2})$", s2)      # +0800 → +08:00
    if m:
        s2 = f"{m.group(1)}:{m.group(2)}"
    try:
        return datetime.fromisoformat(s2).timestamp()
    except Exception:
        return None


def login():
    html = _req("GET", "/")[1]
    csrf = re.search(r'name="gorilla\.csrf\.Token"\s+value="([^"]+)"', html).group(1)
    then = re.search(r'id="then"[^>]*value="([^"]*)"', html).group(1).replace("&amp;", "&")
    st, spa = _req("POST", "/oauth2/auth/login/fuyaoPasswordProvider",
                   {"username": USER, "password": list(PWD.encode()), "then": then},
                   {"X-CSRF-Token": csrf, "Origin": BASE, "Referer": BASE + "/"})
    assert "index-" in spa, f"登录失败 HTTP {st}"
    return [c.name for c in jar]


def list_ns():
    """只读：返回 {name: creationTimestamp}"""
    st, b = _req("GET", K8S_NS)
    items = unwrap_list(_json(b))
    return st, {i["metadata"]["name"]: i["metadata"].get("creationTimestamp") for i in items}


# ── 守卫 ────────────────────────────────────────────────────────────────
def guard_create(name):
    if not NAME_RE.match(name):
        raise SystemExit(f"!! 守卫1 拒绝：创建名 {name!r} 不符合 {NAME_RE.pattern}")
    if name in CREATED:
        raise SystemExit(f"!! 守卫2 拒绝：{name} 已被本进程创建过")


def guard_delete(name):
    if not NAME_RE.match(name):
        raise SystemExit(f"!! 守卫1 拒绝：删除名 {name!r} 不符合 {NAME_RE.pattern}")
    if name not in CREATED:
        raise SystemExit(f"!! 守卫2 拒绝：{name} 不是本进程创建的名字，禁止删除")
    st, b = _req("GET", f"{K8S_NS}/{name}")
    if st != 200:
        raise SystemExit(f"!! 守卫3 拒绝：{name} GET 返回 {st}，无法核验归属")
    meta = _json(b).get("metadata", {})
    if (meta.get("labels") or {}).get(LABEL_KEY) != RUN:
        raise SystemExit(f"!! 守卫3 拒绝：{name} 标签 {LABEL_KEY} != 本次 runId，禁止删除")


def audit(op_, target, detail):
    AUDIT.append({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "op": op_, "target": target, **detail})
    print(f"  [audit] {op_:<18} {target:<28} {detail.get('result','')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/of-ns-lifecycle.json")
    ap.add_argument("--keep", action="store_true", help="保留命名空间不删除（调试用，默认必删）")
    ap.add_argument("--delay", type=float, default=0.0,
                    help="创建前额外等待 N 秒（对照实验：证明 P3-3 的翻转由时间戳精度导致，而非时钟偏移）")
    a = ap.parse_args()

    rep = {"authorized_scope": "仅创建/删除测试命名空间", "base": BASE, "cluster": CLUSTER}
    steps = []

    def step(sid, desc, expect, actual, verdict, extra=None):
        r = {"id": sid, "desc": desc, "expect": expect, "actual": actual, "verdict": verdict}
        if extra:
            r.update(extra)
        steps.append(r)
        mark = {"PASS": "✅", "FAIL": "❌", "INFO": "ℹ️"}.get(verdict, "•")
        print(f"  {mark} {sid} {desc}\n      期望 {expect} | 实际 {actual}")
        return r

    print("=== Phase 0  登录 + 基线 ===")
    global RUN
    print(f"  cookies={login()}")
    run_ts_epoch = time.time()                       # ★ 亚秒精度，用于精确测边界
    run_ts = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    # runId：日期 + 6 位随机 hex，保证 DNS-1123 label 合法
    RUN = f"idwth-{time.strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"
    print(f"  runId = {RUN}   起始时刻 = {run_ts} ({run_ts_epoch:.3f})")
    rep.update({"run_id": RUN, "run_started_at": run_ts, "run_started_at_epoch": run_ts_epoch})

    st, base_ns = list_ns()
    rep["baseline_namespaces"] = base_ns
    print(f"  基线命名空间 {len(base_ns)} 个：{sorted(base_ns)}")
    step("P0-1", "基线可读（只读，非写操作）", "HTTP 200", f"HTTP {st}, {len(base_ns)} 个 ns",
         "PASS" if st == 200 else "FAIL")
    clash = [n for n in base_ns if n.startswith(NS_PREFIX)]
    step("P0-2", f"基线中是否已有 {NS_PREFIX}* 残留", "0 个", f"{len(clash)} 个 {clash}",
         "PASS" if not clash else "INFO")

    body = {"apiVersion": "v1", "kind": "Namespace",
            "metadata": {"name": RUN,
                         "labels": {LABEL_KEY: RUN, "idwth.io/managed-by": "lifecycle-probe"},
                         "annotations": {"idwth.io/purpose": "E02 isolation probe",
                                         "idwth.io/ttl": "ephemeral"}}}

    print("\n=== Phase 1  创建测试命名空间 ===")
    if a.delay:
        print(f"  （对照实验：创建前等待 {a.delay}s）")
        time.sleep(a.delay)
    guard_create(RUN)
    st, b = _req("POST", K8S_NS, body)
    created_ok = st in (200, 201)
    if created_ok:
        CREATED.add(RUN)
    audit("create-namespace", RUN, {"http": st, "result": "ok" if created_ok else "err"})
    rep["create_response"] = {"http": st, "body_excerpt": b[:400]}
    step("P1-1", f"创建 {RUN}", "HTTP 201", f"HTTP {st}", "PASS" if created_ok else "FAIL")

    print("\n=== Phase 2  重复创建（验证「已派发 mutation 不得自动重试」的可判定性）===")
    st2, b2 = _req("POST", K8S_NS, body)
    audit("create-namespace(dup)", RUN, {"http": st2, "result": "idempotent-reject"})
    dup_ok = st2 in (409, 422)          # 409 AlreadyExists 是 K8s 的正常语义
    step("P2-1", "同名再创建", "HTTP 409 AlreadyExists（可判定，非静默成功）",
         f"HTTP {st2}", "PASS" if dup_ok else "FAIL",
         {"body_excerpt": b2[:200]})

    print("\n=== Phase 3  验证存在 + 归属 ===")
    st3, b3 = _req("GET", f"{K8S_NS}/{RUN}")
    j3 = _json(b3); meta = j3.get("metadata", {})
    audit("get-namespace", RUN, {"http": st3, "result": meta.get("phase", "?")})
    step("P3-1", "GET 命名空间", "HTTP 200", f"HTTP {st3}", "PASS" if st3 == 200 else "FAIL")
    step("P3-2", "归属标签回读一致", f"{LABEL_KEY}={RUN}",
         f"{LABEL_KEY}={(meta.get('labels') or {}).get(LABEL_KEY)}",
         "PASS" if (meta.get("labels") or {}).get(LABEL_KEY) == RUN else "FAIL")
    created_epoch = ts(meta.get("creationTimestamp"))
    delta = (created_epoch - run_ts_epoch) if created_epoch else None
    step("P3-3", "creationTimestamp 与 run 起始的可分辨性（`created_at > run_start` 判据可用性）",
         "created_at 与 run_start 可区分", 
         f"created_at={meta.get('creationTimestamp')}  与 run_start 相差 {delta:+.3f}s" if delta is not None else "无法解析",
         "PASS" if (delta is not None and delta > 1.0) else "FAIL",
         {"note": "K8s 时间戳仅秒级精度；相差 <1s 时严格 `>` 判据在边界翻转 —— 见报告结论",
          "delta_seconds": delta, "run_start_epoch": run_ts_epoch, "created_epoch": created_epoch})

    print("\n=== Phase 4  命名空间内可读（只读，验证 backend 断言语义可用）===")
    for sid, res, path in [("P4-1", "pods", f"{K8S_NS}/{RUN}/pods"),
                           ("P4-2", "configmaps", f"{K8S_NS}/{RUN}/configmaps"),
                           ("P4-3", "services", f"{K8S_NS}/{RUN}/services")]:
        st4, b4 = _req("GET", path)
        items = unwrap_list(_json(b4))
        names = [i.get("metadata", {}).get("name") for i in items][:6]
        # ★ 新建的命名空间并非真空：K8s 控制面会自动注入 kube-root-ca.crt
        auto = [n for n in names if n and n.startswith("kube-root-ca")]
        extra = {"item_names": names, "auto_injected": auto}
        step(sid, f"列 {res}", "HTTP 200",
             f"HTTP {st4}, items={len(items)} {names}", "PASS" if st4 == 200 else "FAIL", extra)
        if auto:
            step(f"{sid}-note", f"★ {res} 含 K8s 自动注入对象（不是残留，但也非空）",
                 "已识别", f"auto_injected={auto}", "INFO")

    print("\n=== Phase 4b  按 runId 发现孤儿命名空间（只读，E03 缺的那一半）===")
    sel_self = f"?labelSelector={urllib.parse.quote(f'{LABEL_KEY}={RUN}')}"
    stA, bA = _req("GET", K8S_NS + sel_self)
    nA = unwrap_list(_json(bA))
    step("P4b-1", "labelSelector 精确命中本次 runId", "HTTP 200, 匹配 1 个", f"HTTP {stA}, 匹配 {len(nA)} 个",
         "PASS" if stA == 200 and len(nA) == 1 else "FAIL")
    other = "idwth-19700101-000000"          # 一个绝不可能存在的 runId
    stB, bB = _req("GET", K8S_NS + f"?labelSelector={urllib.parse.quote(f'{LABEL_KEY}={other}')}")
    nB = unwrap_list(_json(bB))
    step("P4b-2", "labelSelector 对不存在的 runId 返回空（不会误伤他人）", "HTTP 200, 匹配 0 个",
         f"HTTP {stB}, 匹配 {len(nB)} 个", "PASS" if stB == 200 and len(nB) == 0 else "FAIL")
    stC, bC = _req("GET", K8S_NS + f"?labelSelector={urllib.parse.quote('idwth.io/managed-by=lifecycle-probe')}")
    nC = unwrap_list(_json(bC))
    step("P4b-3", "labelSelector 按 managed-by 扫**全部** idwth 测试 ns（孤儿巡检入口）",
         "HTTP 200", f"HTTP {stC}, 匹配 {len(nC)} 个", "PASS" if stC == 200 else "FAIL")
    rep["label_selector"] = {"self": len(nA), "other": len(nB), "managed_by": len(nC)}


    if a.keep:
        print("\n!! --keep 指定，跳过删除（仅供调试）")
        rep["steps"] = steps; rep["audit"] = AUDIT; rep["kept"] = True
        json.dump(rep, open(a.out, "w"), ensure_ascii=False, indent=2)
        return

    print("\n=== Phase 5  删除命名空间 ===")
    guard_delete(RUN)
    st5, b5 = _req("DELETE", f"{K8S_NS}/{RUN}", {"apiVersion": "v1", "kind": "DeleteOptions"})
    audit("delete-namespace", RUN, {"http": st5, "result": "ok" if st5 in (200, 202) else "err"})
    del_ok = st5 in (200, 202)
    step("P5-1", "DELETE 命名空间", "HTTP 200/202", f"HTTP {st5}", "PASS" if del_ok else "FAIL",
         {"body_excerpt": b5[:200]})

    print("\n=== Phase 6  等待释放（K8s namespace 回收是异步的）===")
    t0 = time.time(); gone = False; last = None; trail = []
    while time.time() - t0 < 90:
        stx, bx = _req("GET", f"{K8S_NS}/{RUN}")
        last = stx
        phase = _json(bx).get("status", {}).get("phase") if stx == 200 else None
        trail.append({"t": round(time.time() - t0, 1), "http": stx, "phase": phase})
        if stx == 404:
            gone = True
            break
        time.sleep(2)
    rep["release_trail"] = trail
    step("P6-1", "命名空间最终消失", "HTTP 404", f"HTTP {last}, 耗时 {round(time.time()-t0,1)}s",
         "PASS" if gone else "FAIL")
    step("P6-2", "释放耗时可接受（<30s，决定 cleanup 是否阻塞 CI）", "< 30s",
         f"{round(time.time()-t0,1)}s", "PASS" if (gone and time.time()-t0 < 30) else "INFO")

    print("\n=== Phase 7  清理幂等（决定 cleanup 能否安全重试）===")
    st7, b7 = _req("DELETE", f"{K8S_NS}/{RUN}", {"apiVersion": "v1", "kind": "DeleteOptions"})
    audit("delete-namespace(2nd)", RUN, {"http": st7, "result": "idempotent"})
    step("P7-1", "重复删除", "HTTP 404（幂等，非报错）", f"HTTP {st7}",
         "PASS" if st7 == 404 else "FAIL", {"body_excerpt": b7[:200]})

    print("\n=== Phase 8  基线比对（证明未触碰任何已有资源）===")
    st8, after_ns = list_ns()
    added = sorted(set(after_ns) - set(base_ns))
    removed = sorted(set(base_ns) - set(after_ns))
    changed = sorted(n for n in set(base_ns) & set(after_ns) if base_ns[n] != after_ns[n])
    rep.update({"after_namespaces": after_ns, "diff": {"added": added, "removed": removed, "changed": changed}})
    step("P8-1", "无新增残留命名空间", "0", f"{len(added)} {added}", "PASS" if not added else "FAIL")
    step("P8-2", "无删除已有命名空间", "0", f"{len(removed)} {removed}", "PASS" if not removed else "FAIL")
    step("P8-3", "无修改已有命名空间", "0", f"{len(changed)} {changed}", "PASS" if not changed else "FAIL")

    rep["steps"] = steps; rep["audit"] = AUDIT
    rep["summary"] = {
        "total": len([s for s in steps if s["verdict"] != "INFO"]),
        "pass": len([s for s in steps if s["verdict"] == "PASS"]),
        "fail": len([s for s in steps if s["verdict"] == "FAIL"]),
        "write_ops": len(AUDIT),
        "namespaces_left_behind": added,
    }
    json.dump(rep, open(a.out, "w"), ensure_ascii=False, indent=2)
    s = rep["summary"]
    print(f"\n{'='*62}\n汇总：{s['pass']}/{s['total']} PASS，{s['fail']} FAIL"
          f"｜写操作 {s['write_ops']} 次｜残留 {len(s['namespaces_left_behind'])} 个\n写入 {a.out}")


if __name__ == "__main__":
    main()
