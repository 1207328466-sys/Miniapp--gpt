# -*- coding: utf-8 -*-
"""护航服务「预约」记录体检（**只读**）：列出 / 按姓名手机号找 / 断言"刚提交的那条真进库了"。

【为什么需要它】需求 713555353（护航服务预约）的**成功态**要验两件事：
  ① 小程序里点「提交」之后，弹窗切到「预约提交成功」；
  ② **后台真的有这条记录** —— 只看界面会假绿（接口没落库、或落了但字段被吞）。
  这一步就是②：从管理端接口把预约列表拉下来，按「姓名 + 手机号」找，并给出机器可读的一行。

【为什么走管理端接口、而不是连库】
  预约是"客户线索"，库在测试环境；但管理端接口本来就是后台看这条线索的**同一条路**，
  而且不需要内网直连数据库。当前（2026/10/19）RDS 白名单不通时，这个工具照样能用。
  ⚠️ **管理端没有删除预约的接口**（bundle 里只有 getList / updateHandleStatus，`/delete`、`/remove`
  实测都是 404），所以"跑完复位"只能走库 —— 这就是本工具唯一一处写操作（`--delete`，**默认只预览**）。

【token 从哪来】与 `tools/post_top_tool.py` 一致：
  环境变量 `UITEST_MANAGER_TOKEN` > `%TEMP%/manager-token.txt` > `--login` 现场登一次。

用法:
    python tools/escort_appointment_tool.py --list                  # 最近 10 条（只读）
    python tools/escort_appointment_tool.py --name 自动化测试 --contact 13311111111
    python tools/escort_appointment_tool.py --snapshot               # 只打 id 快照（给 --before-ids 用）
    python tools/escort_appointment_tool.py --expect-new --name X --contact 13900000000
        （给"提交前先存一份 id 快照、提交后再跑一次"的调用方用：只把**快照之后新增**的算数）
    python tools/escort_appointment_tool.py --delete --id 140 --name X --contact 13900000000
        （**默认只预览**；再加 --yes 才真删。必须带 id + 姓名 + 手机号三者对得上 —— 免得删错别人的线索）

机器读的那一行：
    [RESERVE] total=116 matched=1 new=0 ids=[] latest=138

退出码: 0 成功；1 `--expect-new` 但没找到新增 / 删除核对不上；2 token 缺失/过期
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
API = "https://zhuwen-alpha.supreium.com/api"
LIST_PATH = "/manager/escort/appointment/getList"
DEFAULT_TOKEN_FILE = Path(os.environ.get("TEMP", ".")) / "manager-token.txt"
DEFAULT_PAGE_SIZE = 200  # 一次拉够：预约不会多到需要分页翻（2026/10/19 实测 116 条）
DEFAULT_DB_CONFIG = ROOT / "config" / "db.local.yaml"


def unwrap(raw):
    """token 文件里可能是一段裸 JWT，也可能是 `{"content": "..."}` 这种包装。"""
    t = (raw or "").strip()
    if not t.startswith("{"):
        return t
    try:
        return json.loads(t).get("content") or ""
    except Exception:
        return ""


def new_ids(before_ids, records):
    """**纯函数**：在 `records` 里挑出"id 不在 before_ids 里"的那些（新的在前）。

    为什么要快照而不是"按名字找最新的"：同一个人可能以前也约过（库里已经有一堆
    「自动化测试 / 13311111111」），只按名字找会把**旧记录**当成本次提交 —— 假绿。
    """
    seen = {int(x) for x in (before_ids or [])}
    out = []
    for r in records or []:
        try:
            rid = int(r.get("id"))
        except (TypeError, ValueError):
            continue
        if rid not in seen:
            out.append(rid)
            seen.add(rid)  # 同一 id 出现两次只算一次（接口偶发重复时别把"新增 1 条"说成 2 条）
    return out


def load_token(args):
    env_token = unwrap(os.environ.get("UITEST_MANAGER_TOKEN"))
    if env_token:
        return env_token
    path = Path(args.token_file)
    if path.exists():
        tok = unwrap(path.read_text(encoding="utf-8"))
        if tok:
            return tok
    if args.login:
        sys.path.insert(0, str(ROOT / "tools"))
        import post_top_tool  # noqa: E402

        return post_top_tool.login_and_save(str(path), args.creds) or ""
    return ""


def fetch(records_page_size, token, timeout=25):
    r = requests.post(
        API + LIST_PATH,
        json={"pageNumber": 1, "pageSize": records_page_size},
        headers={"Authorization": token},
        timeout=timeout,
    )
    if r.status_code != 200:
        raise RuntimeError("管理端返回 HTTP %s：%s" % (r.status_code, r.text[:200]))
    body = r.json()
    if not body.get("success", False):
        raise RuntimeError("管理端返回失败：%s" % (body.get("msg") or body))
    return body.get("data") or {}


def check_delete_target(row, name, contact, apply=False):
    """**纯函数**：删除前的三道闸。返回 (能否继续, 说明)。

    `row` = `(id, name, contact, is_deleted)`，或者 None（库里没这条）。
    抽成纯函数是为了离线自检能钉住"该拦的必须拦"（见 scripts/selftest-escort-reserve.py）。
    """
    if not row:
        return False, "库里没有这条预约（先 --list 确认 id）"
    rid, rname, rcontact, rdel = row
    if str(rname or "") != str(name) or str(rcontact or "") != str(contact):
        return False, (
            "姓名/手机号对不上，拒绝删除：库里是「%s / %s」，你给的是「%s / %s」"
            % (rname, rcontact, name, contact)
        )
    if int(rdel or 0) != 0:
        return False, "id=%s 已经是删除状态（is_deleted=1）" % rid
    if not apply:
        return False, "预览：将执行 update escort_appointment set is_deleted=1 where id=%s（加 --yes 才真删）" % rid
    return True, "可以删除 id=%s" % rid


def soft_delete_one(appointment_id, name, contact, db_config=DEFAULT_DB_CONFIG, apply=False):
    """把一条预约**软删**（`is_deleted=1`），返回 (是否真删了, 说明)。

    硬删是 `DELETE`，这里坚持软删：管理端所有查询都带 `is_deleted=0`，软删对界面等价，
    但误删时还能捞回来（客户线索不该真消失）。

    【三道闸】
      1. 必须点名 `--id`，且**姓名 + 手机号都要对得上**（防"手滑删了别人那条"）；
      2. `--yes` 才真删，否则只预览（打印将要执行什么）；
      3. 删完**回读**：`rowcount` 必须正好 1 —— 0 行说明"没这条/已经被删过"，当场说清楚。
    """
    from quiz_data_cleanup import load_conn

    conn = load_conn(str(db_config))
    try:
        cur = conn.cursor()
        cur.execute(
            "select id, name, contact, is_deleted from escort_appointment where id = %s",
            (int(appointment_id),),
        )
        row = cur.fetchone()
        ok, msg = check_delete_target(row, name, contact, apply=apply)
        if not ok:
            return False, msg
        cur.execute(
            "update escort_appointment set is_deleted = 1 where id = %s and is_deleted = 0",
            (int(appointment_id),),
        )
        conn.commit()
        if cur.rowcount != 1:
            return False, "update 影响 %d 行（期望 1 行）—— 没删成，请复查" % cur.rowcount
        cur.execute("select is_deleted from escort_appointment where id = %s", (int(appointment_id),))
        after = cur.fetchone()
        if not after or int(after[0] or 0) != 1:
            return False, "删完回读 is_deleted 仍不是 1 —— 没删成，请复查"
        return True, "已软删 id=%s（is_deleted 0 -> 1，可回捞）" % appointment_id
    finally:
        conn.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description="护航预约记录体检（只读）")
    parser.add_argument("--list", action="store_true", help="列出最近 N 条（只读）")
    parser.add_argument("--limit", type=int, default=10, help="--list 时打印几条（默认 10）")
    parser.add_argument("--name", default="", help="按姓名过滤（与 --contact 一起用）")
    parser.add_argument("--contact", default="", help="按手机号过滤")
    parser.add_argument("--expect-new", action="store_true", help="断言存在快照之后新增的记录")
    parser.add_argument("--before-ids", default="", help="提交前抓到的 id 快照，逗号分隔（或 JSON 数组）")
    parser.add_argument("--snapshot", action="store_true", help="只打印当前 id 快照（给 --before-ids 用）")
    parser.add_argument("--delete", action="store_true", help="软删一条（默认只预览，要加 --yes）")
    parser.add_argument("--id", type=int, default=0, help="--delete 的目标 id")
    parser.add_argument("--yes", action="store_true", help="--delete 时真的写库")
    parser.add_argument("--db-config", default=str(DEFAULT_DB_CONFIG), help="删除时用的数据库配置")
    parser.add_argument("--token-file", default=str(DEFAULT_TOKEN_FILE))
    parser.add_argument("--creds", default=str(ROOT.parent / "miniapp-flow" / ".env"))
    parser.add_argument("--login", action="store_true", help="token 缺失时现场登一次中台")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    token = load_token(args)
    if not token:
        print("[拒绝] 没有可用的管理端 token：设 UITEST_MANAGER_TOKEN，或加 --login 现场登一次")
        return 2

    try:
        data = fetch(args.page_size, token)
    except Exception as e:
        print("[失败] 拉预约列表失败：%s" % str(e).split("\n")[0])
        return 1

    records = data.get("records") or []
    total = data.get("total")

    if args.snapshot:
        ids = [int(r["id"]) for r in records if str(r.get("id", "")).isdigit()]
        print("[RESERVE-SNAPSHOT] ids=%s" % json.dumps(ids))
        return 0

    if args.delete:
        if not args.id:
            print("[拒绝] --delete 必须点名 --id（先 --list 看 id）")
            return 1
        if not (args.name and args.contact):
            print("[拒绝] --delete 还要带 --name 和 --contact（跟库里那条对得上才删）")
            return 1
        ok, msg = soft_delete_one(
            args.id, args.name, args.contact, db_config=args.db_config, apply=bool(args.yes)
        )
        print(("[RESERVE] deleted=1 id=%s" if ok else "[RESERVE] deleted=0 id=%s") % args.id)
        print("  " + msg)
        if not ok:
            return 1
        # 删完再看一眼管理端列表：真没了才算数（接口过滤 is_deleted=0）
        try:
            after = fetch(args.page_size, token)
            alive = {int(r["id"]) for r in (after.get("records") or []) if str(r.get("id", "")).isdigit()}
            print("  管理端列表里%s id=%s" % ("**仍然能看到**" if args.id in alive else "已经看不到", args.id))
            return 0 if args.id not in alive else 1
        except Exception as e:
            print("  （回读列表失败，不影响删除结果：%s）" % str(e).split("\n")[0])
            return 0

    matched = records
    if args.name or args.contact:
        matched = [
            r
            for r in records
            if (not args.name or str(r.get("name") or "") == args.name)
            and (not args.contact or str(r.get("contact") or "") == args.contact)
        ]

    before = []
    if args.before_ids:
        raw = args.before_ids.strip()
        before = json.loads(raw) if raw.startswith("[") else [x for x in raw.split(",") if x.strip()]
    added = new_ids(before, matched) if (args.expect_new or args.before_ids) else []

    if args.list or not (args.name or args.contact):
        print("预约记录共 %s 条；本页 %d 条，最近 %d 条：" % (total, len(records), min(args.limit, len(records))))
        for r in records[: args.limit]:
            print(
                "  id=%-6s %s / %s / 期望交付 %s / 提交 %s / 处理状态=%s"
                % (
                    r.get("id"),
                    r.get("name"),
                    r.get("contact"),
                    r.get("expectDeliverTime"),
                    r.get("submitTime"),
                    r.get("handleStatus"),
                )
            )
    else:
        print("按「姓名=%s / 手机号=%s」匹配到 %d 条" % (args.name or "(不限)", args.contact or "(不限)", len(matched)))
        for r in matched[: args.limit]:
            print("  id=%s 提交=%s 期望交付=%s" % (r.get("id"), r.get("submitTime"), r.get("expectDeliverTime")))

    print(
        "[RESERVE] total=%s matched=%d new=%d ids=%s latest=%s"
        % (
            total,
            len(matched),
            len(added),
            json.dumps(added),
            (matched[0].get("id") if matched else None),
        )
    )

    if args.expect_new and not added:
        print(
            "[失败] 没有找到「快照之后新增」的预约记录。\n"
            "  可能：① 提交没落库（真问题）；② 姓名/手机号跟表单里填的不一致；\n"
            "  ③ 快照取错了（--before-ids 要在**提交之前**抓）。"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
