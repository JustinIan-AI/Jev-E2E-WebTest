#!/usr/bin/env python3
"""只读：测量本机时钟 与 被测系统（K8s API / 控制台）时钟的偏移。

用途：验证 `created_at > run_start` 这类「runId 作用域判据」是否可靠。
判据若依赖两端时钟对齐，秒级偏移即可让它恒真/恒假，而报告里看不出异常。

只读，不做任何写操作。凭据从环境变量读取。
"""
import os, ssl, json, re, gzip, sys, time
from datetime import datetime, timezone
import urllib.request, urllib.error, http.cookiejar

BASE = os.environ.get("OF_BASE", "https://openfuyao-staging.internal.example.com:31616")
CLUSTER = os.environ.get("OF_CLUSTER", "host")
USER = os.environ.get("OF_USER"); PWD = os.environ.get("OF_PWD")
if not (USER and PWD):
    sys.exit("!! 需先设置 OF_USER / OF_PWD")

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),
                                 urllib.request.HTTPSHandler(context=ctx))
op.addheaders = [("User-Agent", "Mozilla/5.0")]


def call(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Accept": "application/json"}
    if data is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    t0 = time.time()
    try:
        resp = op.open(r, timeout=40); d = resp.read()
        code = resp.status
        hdr = dict(resp.headers)
    except urllib.error.HTTPError as e:
        d = e.read(); code = e.code; hdr = dict(e.headers)
    t1 = time.time()
    if hdr.get("Content-Encoding") == "gzip":
        d = gzip.decompress(d)
    return code, d.decode("utf-8", "replace"), hdr, t0, t1


def server_time(hdr, t0, t1):
    """HTTP Date 头只有秒级精度，取请求中点作为本地参照。"""
    ds = hdr.get("Date")
    if not ds:
        return None, None
    st = datetime.strptime(ds, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc)
    local_mid = (t0 + t1) / 2
    return st.timestamp(), local_mid


# ── 登录 ──
_, html, _, _, _ = call("GET", "/")
csrf = re.search(r'name="gorilla\.csrf\.Token"\s+value="([^"]+)"', html).group(1)
then = re.search(r'id="then"[^>]*value="([^"]*)"', html).group(1).replace("&amp;", "&")
call("POST", "/oauth2/auth/login/fuyaoPasswordProvider",
     {"username": USER, "password": list(PWD.encode()), "then": then},
     {"X-CSRF-Token": csrf, "Origin": BASE, "Referer": BASE + "/"})
print("[OK] 已登录\n")

print("=== 本机时钟 vs 被测系统时钟 ===")
local_now = time.time()
print(f"  本机 (UTC)          : {datetime.fromtimestamp(local_now, timezone.utc).isoformat()}")
print(f"  本机 (本地)          : {datetime.fromtimestamp(local_now).isoformat()}")
print()

# 探三个端点，取 K8s API 的 Date 头（最权威，直接来自集群）
probes = [
    ("K8s API  namespaces", f"/clusters/{CLUSTER}/api/kubernetes/api/v1/namespaces"),
    ("K8s API  version",    f"/clusters/{CLUSTER}/api/kubernetes/version"),
    ("控制台 REST",          "/rest/multicluster/v1beta1/resources/clusters"),
]
offsets = []
for name, p in probes:
    code, body, hdr, t0, t1 = call("GET", p)
    st, lm = server_time(hdr, t0, t1)
    if st is None:
        print(f"  {name:<24} HTTP {code}  无 Date 头")
        continue
    off = st - lm
    offsets.append(off)
    print(f"  {name:<24} HTTP {code}  server={datetime.fromtimestamp(st, timezone.utc).strftime('%H:%M:%S')}Z "
          f"local={datetime.fromtimestamp(lm, timezone.utc).strftime('%H:%M:%S')}Z  偏移={off:+.2f}s")
    print(f"      Date 头原文: {hdr.get('Date')}")

# 用 K8s 事件/资源时间戳再交叉验证一次：读一个既有命名空间的 creationTimestamp
print()
code, body, hdr, t0, t1 = call("GET", f"/clusters/{CLUSTER}/api/kubernetes/api/v1/namespaces/kube-public")
j = json.loads(body); j = j.get("data", j)
ct = j.get("metadata", {}).get("creationTimestamp")
print(f"  交叉验证：既有 ns kube-public creationTimestamp = {ct}  （集群写入的时间戳，非本机生成）")

if offsets:
    avg = sum(offsets) / len(offsets)
    print(f"\n=== 结论 ===")
    print(f"  平均偏移 server - local = {avg:+.2f}s")
    if abs(avg) < 1:
        print("  两端基本同步；但注意 HTTP Date 只有秒级精度，判定不宜依赖亚秒精度")
    else:
        print(f"  ⚠️ 存在 {avg:+.2f}s 偏移 → `created_at > run_start` 这类判据在秒级会翻转")
    print("  无论偏移多少：**判据不应依赖两端时钟对齐**，应改用「名字/标签内嵌 runId」")

json.dump({"local_utc": datetime.fromtimestamp(local_now, timezone.utc).isoformat(),
           "offsets_s": offsets, "avg_offset_s": (sum(offsets)/len(offsets)) if offsets else None,
           "kube_public_creation": ct},
          open("/tmp/of-clock-skew.json", "w"), ensure_ascii=False, indent=2)
print("\n[OK] 写 /tmp/of-clock-skew.json")
