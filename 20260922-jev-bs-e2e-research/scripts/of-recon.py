#!/usr/bin/env python3
"""
openFuyao 目标侦察（可复跑）—— 只读，不创建/修改任何业务资源。

用途：E01 类型的「目标系统能不能做首批验证对象」侦察。
产出：登录机理 + 前端技术栈 + 路由面 + API 面 + i18n 文案面（= 测试面权威清单）。

凭据从环境变量读取，不落盘、不写进任何产物文件。

用法：
  export OF_USER=... OF_PWD=...
  python3 of-recon.py                     # 全量侦察
  python3 of-recon.py --api               # 附加只读 API 探测
  OF_BASE=https://host:port python3 of-recon.py
"""
import os, ssl, json, re, gzip, sys, argparse
import urllib.request, urllib.error, http.cookiejar

BASE = os.environ.get("OF_BASE", "https://openfuyao-staging.internal.example.com:31616")
USER = os.environ.get("OF_USER"); PWD = os.environ.get("OF_PWD")
if not (USER and PWD):
    sys.exit("!! 需先设置 OF_USER / OF_PWD 环境变量（不要写进文件）")

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ctx))
op.addheaders = [("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
                 ("Accept-Language", "zh-CN,zh;q=0.9")]


def get(path, raw=False):
    r = op.open(BASE + path, timeout=30); d = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        d = gzip.decompress(d)
    return r, (d if raw else d.decode("utf-8", "replace"))


def unesc(s):
    return re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s)


def login():
    """openFuyao 登录：OAuth2 授权码 + gorilla CSRF + per-request state。
    注意：csrf/state 每次请求都变 → 登录步骤不可冻结回放。"""
    html = get("/")[1]
    csrf = re.search(r'name="gorilla\.csrf\.Token"\s+value="([^"]+)"', html).group(1)
    then = re.search(r'id="then"[^>]*value="([^"]*)"', html).group(1).replace("&amp;", "&")
    req = urllib.request.Request(
        BASE + "/oauth2/auth/login/fuyaoPasswordProvider",
        data=json.dumps({"username": USER, "password": list(PWD.encode()), "then": then}).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "X-CSRF-Token": csrf,
                 "Origin": BASE, "Referer": BASE + "/"})
    spa = op.open(req, timeout=30).read().decode("utf-8", "replace")
    assert "index-" in spa, "登录后未拿到 SPA"
    return spa, [c.name for c in jar]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", action="store_true", help="附加只读 API 探测")
    ap.add_argument("--out", default="/tmp/of-recon.json")
    a = ap.parse_args()
    rep = {"base": BASE}

    spa, cookies = login()
    print(f"[OK] 登录成功  cookies={cookies}")
    rep["login_cookies_after"] = cookies
    bundle = re.search(r'src="(/assets/index-[^"]+\.js)"', spa).group(1)
    rep["bundle"] = bundle
    js = get(bundle)[1]
    rep["bundle_bytes"] = len(js)
    print(f"[OK] bundle {bundle}  {len(js):,} 字符")

    # 路由面
    rep["routes"] = sorted({p for p in re.findall(r'path:\s*"([^"]{2,90})"', js) if p.startswith("/")})
    # API 面
    u = unesc(js)
    rep["api_paths"] = sorted(set(re.findall(r'/rest/[A-Za-z0-9_\-/{}\$\\.]{1,90}', u)))
    # URL 模板表（集群前缀代理）
    seg = u[u.find("podUrl"):u.find("podUrl") + 1800] if "podUrl" in u else ""
    rep["url_templates"] = sorted(set(re.findall(r'[a-zA-Z]+Url:\s*`([^`]+)`', seg)))
    rep["url_templates_raw"] = re.sub(r"\s+", " ", seg)[:1200]
    # i18n 机制
    rep["i18n_loadPath"] = (re.search(r'loadPath:"([^"]+)"', js) or [None, None])[1]
    rep["i18n_ns"] = sorted(set(re.findall(r'ns:"([a-zA-Z0-9_-]{2,40})"', js)))
    # 前端指纹（词边界，避免 maxTerm 之类子串假阳性）
    fp = {}
    for k, p in {"react": r"react-dom|createRoot|useState\(", "antd": r"ant-design|antd|ant-btn",
                 "vue": r"Vue\.createApp|defineComponent", "echarts": r"echarts",
                 "monaco": r"monaco-editor", "microFE": r"qiankun|__federation|wujie|micro-app",
                 "iframe(真使用)": r'createElement\("iframe"\)'}.items():
        fp[k] = len(re.findall(p, js))
    rep["frontend"] = fp
    # 集群态存哪
    rep["cluster_state"] = {
        "storage": "sessionStorage" if 'sessionStorage.getItem("cluster")' in js else "?",
        "set_on_switch": bool(re.search(r'setItem\("cluster"', js)),
        "route_contains_cluster": bool(re.search(r'path:\s*"/clusters?/', js)),
    }

    print("\n=== 路由面 ===")
    print(f"  {len(rep['routes'])} 条；样例: " + ", ".join(rep["routes"][:8]))
    print("=== API 面 ===")
    for p in rep["api_paths"][:20]:
        print("  ", p)
    print("=== 集群前缀 URL 模板 ===")
    for p in rep["url_templates"][:14]:
        print("  ", p)
    print(f"\n=== i18n ===\n  loadPath={rep['i18n_loadPath']}\n  ns={rep['i18n_ns']}")
    print(f"\n=== 前端指纹（词边界）===\n  {fp}")
    print(f"\n=== 集群态 ===\n  {rep['cluster_state']}")

    # i18n 文案面 = 测试面权威清单
    print("\n=== i18n 文案面（菜单/动作词）===")
    rep["i18n_zh"] = {}
    for ns in rep["i18n_ns"]:
        try:
            st, b = get(f"/locales/zh-CN/{ns}.json")
            j = json.loads(b)
            rep["i18n_zh"][ns] = j
            print(f"  /locales/zh-CN/{ns}.json  {len(j)} 顶层键")
        except Exception as e:
            print(f"  {ns} 取失败: {e}")

    if a.api:
        cl = os.environ.get("OF_CLUSTER", "host")
        print(f"\n=== 只读 API 探测（cluster={cl}）===")
        for name, p in [
            ("集群清单", "/rest/multicluster/v1beta1/resources/clusters"),
            ("平台用户", "/rest/user/v1/users"),
            ("命名空间", f"/clusters/{cl}/api/kubernetes/api/v1/namespaces"),
            ("Pod", f"/clusters/{cl}/api/kubernetes/api/v1/namespaces/default/pods"),
            ("Deployment", f"/clusters/{cl}/api/kubernetes/apis/apps/v1/namespaces/default/deployments"),
            ("插件清单", f"/clusters/{cl}/rest/plugin-management/v1beta1/consoleplugins"),
        ]:
            try:
                _, b = get(p)
                j = json.loads(b)
                d = j.get("data", j)
                if isinstance(d, dict) and "items" in d:
                    print(f"  {name:<10} 200  items={len(d['items'])}")
                elif isinstance(d, list):
                    print(f"  {name:<10} 200  list len={len(d)}")
                else:
                    print(f"  {name:<10} 200  {json.dumps(j, ensure_ascii=False)[:160]}")
            except urllib.error.HTTPError as e:
                print(f"  {name:<10} {e.code}")
            except Exception as e:
                print(f"  {name:<10} ERR {e}")

    json.dump(rep, open(a.out, "w"), ensure_ascii=False, indent=2)
    print(f"\n[OK] 报告写 {a.out}")


if __name__ == "__main__":
    main()
