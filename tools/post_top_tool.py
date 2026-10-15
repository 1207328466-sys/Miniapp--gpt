# -*- coding: utf-8 -*-
"""帖子「置顶 / 取消置顶」工具（**走管理后台接口，不直写库**）。

【为什么要有它】缺陷 713367194（"后台设了置顶帖，小程序最新提问里没显示置顶"）要做成回归用例，
就需要"某条帖子被置顶"这个夹具。而**置顶状态不在这套库里**：
`post` 表 32 个列全看过、全库列名带 top/pin 的地方也逐个查过，帖子侧一个置顶字段都没有
—— 置顶是**管理后台的服务**在管，所以只能调它的接口（见 knowledge/管理后台接口与夹具.md）。

【口径（2026/10/15 真机实测）】
  · 接口：`POST /api/manager/postings/topPost {id, isTop}` —— **isTop 是"设成目标值"**（1 置顶 / 0 取消），
    不是 toggle（后台前端原文：`onConfirm: ()=>Z({id, isTop: isTop==0?1:0})`）；
  · 效果：小程序「最新提问」会把置顶帖**放到第一条**、并在标题前加「置顶」
    （实测第一张卡的文字是 `置顶 兄弟 xiba 1`）；
  · ⚠️ **服务端有缓存：约 5~7 分钟**小程序端才会变（实测 14:5x 置顶、15:02 才看到）。
    想立刻看效果会得出"置顶没用"的错误结论 —— 这条记在 docs/踩坑记录.md 坑 49。

【token 从哪来（不打印、不入库）】
  1. 环境变量 `UITEST_MANAGER_TOKEN`（裸 JWT）；或
  2. token 文件（`--token-file`，默认 %TEMP%/manager-token.txt）；或
  3. `--login`：用 python + playwright 起**系统自带 Edge**（headless）登中台 SSO 取 token，
     账号密码从 `--creds` 指向的 .env 读（默认读同事那个 miniapp-flow 仓的 .env）。
  token 过期会**直接拒绝**并告诉你怎么取新的（宁可停，不要拿过期 token 得到一堆 401）。

三道闸：
  1. **必须点名帖子**：`--id` 或 `--title`（按标题找时**重名就拒绝**，不猜一个）；
  2. **默认只预览**：不加 `--yes` 一个字都不改；
  3. token 缺失/过期 -> 拒绝。

用法：
    python tools/post_top_tool.py --list                      # 列最近 20 条（标出置顶与我们账号）
    python tools/post_top_tool.py --title 兄弟                 # 预览：这条现在置顶吗
    python tools/post_top_tool.py --title 兄弟 --pin --yes     # 置顶
    python tools/post_top_tool.py --title 兄弟 --unpin --yes   # 取消置顶
    python tools/post_top_tool.py --login                     # 只取 token（写进 token 文件）

机器读的输出（用例靠它解析）：
    [TOPPOST] mode=state  post=1035 isTop=0 title=兄弟
    [TOPPOST] mode=set    post=1035 isTop=1 title=兄弟
    [TOPPOST] mode=refused reason=ambiguous matches=2 title=今天天气不错
退出码：0 正常；1 被闸门/凭据拦下；2 参数问题
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TOKEN_FILE = Path(os.environ.get("TEMP", ".")) / "manager-token.txt"
DEFAULT_CREDS = Path(r"C:\Users\admin\Desktop\miniapp-flow\.env")  # 同事那个仓；只读，不打印

API_BASE = os.environ.get("UITEST_MANAGER_API", "https://zhuwen-alpha.supreium.com/api")
ADMIN_URL = os.environ.get("UITEST_ADMIN_URL", "https://zhuwen-alpha.supreium.com/admin")
OUR_USER = 1966910


def log(msg):
    print(msg)


def unwrap(raw):
    """后台 localStorage 里存的是 JSON 包装，HTTP 头要裸 JWT"""
    t = (raw or "").strip()
    if not t.startswith("{"):
        return t
    try:
        return json.loads(t).get("content") or ""
    except Exception:
        return t


def token_expiry(token):
    """返回 (过期时间字符串, 是否已过期)；解不开就当"过期"（宁可拒绝）"""
    import base64

    seg = token.split(".")
    if len(seg) != 3:
        return "-", True
    try:
        payload = seg[1] + "=" * (-len(seg[1]) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        exp = data.get("exp")
        if not exp:
            return "-", True
        return (
            datetime.fromtimestamp(exp, timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S"),
            exp * 1000 <= datetime.now(timezone.utc).timestamp() * 1000,
        )
    except Exception:
        return "-", True


def load_creds(path):
    env = {}
    if not path or not Path(path).exists():
        return env
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if m:
            env[m.group(1)] = m.group(2).strip()
    return env


def login_and_save(token_file, creds_path):
    """用系统自带 Edge 登中台 SSO 取 token（不下载浏览器、不打印凭据）"""
    creds = load_creds(creds_path)
    user = os.environ.get("UITEST_ADMIN_USER") or creds.get("TEST_ADMIN_USERNAME")
    pwd = os.environ.get("UITEST_ADMIN_PASSWORD") or creds.get("TEST_ADMIN_PASSWORD")
    if not user or not pwd:
        print(
            "[拒绝] 没拿到管理后台账号：设 UITEST_ADMIN_USER/UITEST_ADMIN_PASSWORD，"
            "或把 --creds 指向含 TEST_ADMIN_USERNAME/TEST_ADMIN_PASSWORD 的 .env"
        )
        return None
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[拒绝] 取 token 需要 playwright（pip install -r requirements.txt）")
        return None

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        try:
            page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
            page.goto(ADMIN_URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)
            user_sel = "input[type=text], input[name=username], input[placeholder*='账号']"
            pass_sel = "input[type=password], input[name=password]"
            if page.locator(user_sel).count() > 0 and page.locator(pass_sel).count() > 0:
                page.locator(user_sel).first.fill(user)
                page.locator(pass_sel).first.fill(pwd)
                btn = page.locator(
                    "button[type=submit], .login-btn, button:has-text('登 录'), button:has-text('登录')"
                ).first
                if btn.count() == 0:
                    print("[拒绝] 管理后台登录页找不到登录按钮（页面结构可能变了）")
                    return None
                btn.click()
                print("已提交 SSO 登录，等 token…")
                page.wait_for_timeout(8000)
            token = ""
            for _ in range(40):
                token = unwrap(page.evaluate("() => localStorage.getItem('token')"))
                if token:
                    break
                page.wait_for_timeout(1500)
        finally:
            browser.close()

    if not token:
        print("[拒绝] 登录后没取到 localStorage.token（可能触发了风控/验证码）")
        return None
    Path(token_file).write_text(token, encoding="utf-8")
    exp, expired = token_expiry(token)
    print("已取到管理端 token（长度 %d，过期时间 %s），写到 %s" % (len(token), exp, token_file))
    return None if expired else token


def get_token(args):
    if args.login:
        return login_and_save(args.token_file, args.creds)
    env_token = unwrap(os.environ.get("UITEST_MANAGER_TOKEN"))
    if env_token:
        return env_token
    path = Path(args.token_file)
    if path.exists():
        return unwrap(path.read_text(encoding="utf-8"))
    return ""


def call(token, path, body, method="POST"):
    import requests

    headers = {"Authorization": token, "Content-Type": "application/json;charset=UTF-8"}
    payload = json.dumps(body or {}, ensure_ascii=False).encode("utf-8")
    r = requests.request(method, API_BASE + path, headers=headers, data=payload, timeout=30)
    if r.status_code == 401:
        raise SystemExit(
            "[拒绝] 管理端返回 401（token 无效或过期）。\n"
            "  取新的：python tools/post_top_tool.py --login"
        )
    try:
        data = r.json()
    except Exception:
        raise SystemExit("[拒绝] 接口没返回 JSON（HTTP %s）：%s" % (r.status_code, r.text[:200]))
    if data.get("code") != 200:
        raise SystemExit("[拒绝] 接口报错：%s" % json.dumps(data, ensure_ascii=False)[:300])
    return data.get("data")


def list_posts(token, size=20):
    data = call(token, "/manager/postings/getPostList", {"pageNumber": 1, "pageSize": size})
    return data.get("records") or []


def resolve(token, args):
    """按 --id / --title 定位**唯一**一条帖子；重名/找不到都拒绝（不猜）"""
    rows = list_posts(token, 100)
    if args.id:
        hit = [p for p in rows if int(p.get("id")) == int(args.id)]
        if not hit:
            print("[拒绝] 最近 100 条里没有 id=%s（帖子可能更老，或 id 写错了）" % args.id)
            return None
        return hit[0]
    same = [p for p in rows if (p.get("title") or "").strip() == (args.title or "").strip()]
    if not same:
        print("[拒绝] 最近 100 条里没有标题为 %r 的帖子" % args.title)
        return None
    if len(same) > 1:
        print(
            "[拒绝] 标题 %r 有 %d 条重名（id=%s）—— 请改用 --id，别让工具猜"
            % (args.title, len(same), ",".join(str(p["id"]) for p in same))
        )
        print("[TOPPOST] mode=refused reason=ambiguous matches=%d title=%s" % (len(same), args.title))
        return None
    return same[0]


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="帖子置顶/取消置顶（走管理后台接口；默认只预览）")
    ap.add_argument("--list", action="store_true", help="列最近 20 条帖子")
    ap.add_argument("--id", type=int, help="帖子 id（post.id）")
    ap.add_argument("--title", help="帖子标题（后台一字不差；重名会拒绝，让你改用 --id）")
    ap.add_argument("--pin", action="store_true", help="置顶（isTop=1）")
    ap.add_argument("--unpin", action="store_true", help="取消置顶（isTop=0）")
    ap.add_argument("--yes", action="store_true", help="真的调接口写（不加就是只预览）")
    ap.add_argument("--token-file", default=str(DEFAULT_TOKEN_FILE), help="管理端 token 存放文件")
    ap.add_argument("--creds", default=str(DEFAULT_CREDS), help="含 TEST_ADMIN_USERNAME/PASSWORD 的 .env（只读）")
    ap.add_argument("--login", action="store_true", help="用系统自带 Edge 登中台 SSO 取 token 后退出")
    args = ap.parse_args(argv)

    if args.pin and args.unpin:
        print("[拒绝] 二选一：--pin 或 --unpin")
        return 2

    token = get_token(args)
    if not token:
        print(
            "[拒绝] 没有可用的管理端 token。取一个：\n"
            "  python tools/post_top_tool.py --login      # 用系统自带 Edge 登中台 SSO（凭据读 miniapp-flow/.env）\n"
            "  或设环境变量 UITEST_MANAGER_TOKEN（裸 JWT）"
        )
        return 1
    exp, expired = token_expiry(token)
    if expired:
        print("[拒绝] 管理端 token 已过期（%s）。取新的：python tools/post_top_tool.py --login" % exp)
        return 1

    if args.list:
        rows = list_posts(token, 20)
        print("最近 %d 条帖子（isTop=1 是置顶）：" % len(rows))
        for p in rows:
            mark = "  <- 我们账号" if p.get("userId") == OUR_USER else ""
            print(
                "  id=%-5s isTop=%s status=%s 用户=%-8s 评论=%-3s 标题=%s%s"
                % (p.get("id"), p.get("isTop"), p.get("status"), p.get("userId"),
                   p.get("commentCount"), (p.get("title") or "")[:18], mark)
            )
        return 0

    if not args.id and not args.title:
        print("[拒绝] 要点名目标：--id 1035 或 --title 兄弟")
        print("（只想看现状也要点名，免得「顺手全改」）")
        return 2

    post = resolve(token, args)
    if not post:
        return 1
    pid, title, is_top = post.get("id"), (post.get("title") or ""), post.get("isTop")
    print("目标：id=%s isTop=%s status=%s 标题=%r" % (pid, is_top, post.get("status"), title))

    if not (args.pin or args.unpin):
        print("[TOPPOST] mode=state post=%s isTop=%s title=%s" % (pid, is_top, title))
        print("（预览模式：什么都没改。要改加 --pin/--unpin 且 --yes）")
        return 0

    want = 1 if args.pin else 0
    if is_top == want:
        print("它现在就是 isTop=%s，不用改。" % want)
        print("[TOPPOST] mode=state post=%s isTop=%s title=%s" % (pid, is_top, title))
        return 0

    print("要改：isTop %s -> %s（POST /manager/postings/topPost）" % (is_top, want))
    if not args.yes:
        print("（预览：没发请求。确认后加 --yes）")
        return 0

    call(token, "/manager/postings/topPost", {"id": pid, "isTop": want})
    after = [p for p in list_posts(token, 100) if int(p.get("id")) == int(pid)]
    now = after[0].get("isTop") if after else "?"
    print("[已改] id=%s 现在 isTop=%s" % (pid, now))
    print("[TOPPOST] mode=set post=%s isTop=%s title=%s" % (pid, now, title))
    if str(now) != str(want):
        print("[警告] 回读到的 isTop 与期望不一致，请人工看一眼")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
